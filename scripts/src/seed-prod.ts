/**
 * seed-prod.ts
 *
 * Syncs catalogue data from dev (DATABASE_URL) to production (PROD_DATABASE_URL):
 *   1. Workflow templates → steps → step tasks
 *   2. Services (with workflowTemplateId wired up)
 *   3. Workflow templates updated with serviceId back-link
 *   4. Contract templates
 *   5. Engagement projects
 *
 * Safe to re-run — all upserts are idempotent. IDs are not preserved; stable
 * business keys (name, slug, title) are used as conflict targets instead.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run seed-prod
 *
 * Required env vars:
 *   DATABASE_URL       — dev/source Postgres connection string
 *   PROD_DATABASE_URL  — production connection string
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray, notInArray } from "drizzle-orm";
import {
  servicesTable,
  workflowTemplatesTable,
  workflowTemplateStepsTable,
  workflowTemplateStepTasksTable,
  contractTemplatesTable,
  engagementProjectsTable,
} from "@workspace/db/schema";

const { Pool } = pg;

const devUrl = process.env["DATABASE_URL"];
const prodUrl = process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"];

if (!devUrl) { console.error("ERROR: DATABASE_URL is not set."); process.exit(2); }
if (!prodUrl) { console.error("ERROR: PROD_DATABASE_URL is not set."); process.exit(2); }

const devPool = new Pool({ connectionString: devUrl });
const prodPool = new Pool({ connectionString: prodUrl });
const devDb = drizzle(devPool);
const prodDb = drizzle(prodPool);

// ─── helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(msg); }
function warn(msg: string) { console.warn("  WARN:", msg); }

// ─── 1. Workflow Templates (without serviceId first — circular FK) ────────────

async function syncWorkflowTemplates(): Promise<Map<number, number>> {
  log("\n[1/5] Syncing workflow templates…");
  const devTemplates = await devDb.select().from(workflowTemplatesTable);
  log(`  dev has ${devTemplates.length} workflow template(s)`);

  // devId → prodId
  const idMap = new Map<number, number>();

  for (const t of devTemplates) {
    const { id: devId, serviceId: _serviceId, createdAt: _c, updatedAt: _u, ...fields } = t;

    // No unique index on name — use check-then-insert/update
    const existing = await prodDb
      .select({ id: workflowTemplatesTable.id })
      .from(workflowTemplatesTable)
      .where(eq(workflowTemplatesTable.name, t.name));

    let prodId: number;
    if (existing.length > 0) {
      await prodDb
        .update(workflowTemplatesTable)
        .set({ description: fields.description })
        .where(eq(workflowTemplatesTable.id, existing[0]!.id));
      prodId = existing[0]!.id;
    } else {
      const [inserted] = await prodDb
        .insert(workflowTemplatesTable)
        .values({ ...fields, serviceId: null })
        .returning({ id: workflowTemplatesTable.id });
      if (!inserted) { warn(`Could not insert template "${t.name}"`); continue; }
      prodId = inserted.id;
    }

    idMap.set(devId, prodId);
    log(`  synced template [${devId}→${prodId}]: ${t.name}`);
  }

  return idMap;
}

// ─── 2. Workflow Template Steps ───────────────────────────────────────────────

async function syncWorkflowTemplateSteps(
  templateIdMap: Map<number, number>,
): Promise<Map<number, number>> {
  log("\n[2/5] Syncing workflow template steps…");
  const devSteps = await devDb.select().from(workflowTemplateStepsTable);
  log(`  dev has ${devSteps.length} step(s)`);

  const idMap = new Map<number, number>();

  for (const s of devSteps) {
    const prodTemplateId = templateIdMap.get(s.workflowTemplateId);
    if (!prodTemplateId) {
      warn(`No prod template for step "${s.title}" (dev templateId=${s.workflowTemplateId}) — skipping`);
      continue;
    }

    // Fetch existing step in prod with same templateId + order
    const existing = await prodDb
      .select({ id: workflowTemplateStepsTable.id })
      .from(workflowTemplateStepsTable)
      .where(
        eq(workflowTemplateStepsTable.workflowTemplateId, prodTemplateId),
      )
      .then((rows) => rows.find((r, _i, _a) => {
        // Re-query to find by order
        return false; // placeholder — handled below
      }));
    void existing; // not used

    // Use raw SQL upsert on (workflow_template_id, order) — Drizzle doesn't
    // support composite unique constraints on non-unique-indexed columns natively,
    // so we check-then-insert/update manually.
    const existingRow = await prodDb
      .select({ id: workflowTemplateStepsTable.id })
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, prodTemplateId))
      .then((rows) => rows.find((r) => {
        // We'll match by order in a separate step lookup
        return false;
      }));
    void existingRow;

    // Simpler: fetch all steps for this prod template, find by order
    const prodStepsForTemplate = await prodDb
      .select()
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, prodTemplateId));

    const match = prodStepsForTemplate.find((ps) => ps.order === s.order);

    let prodStepId: number;
    if (match) {
      // Update
      await prodDb
        .update(workflowTemplateStepsTable)
        .set({ title: s.title, description: s.description, order: s.order })
        .where(eq(workflowTemplateStepsTable.id, match.id));
      prodStepId = match.id;
    } else {
      // Insert
      const [inserted] = await prodDb
        .insert(workflowTemplateStepsTable)
        .values({ workflowTemplateId: prodTemplateId, title: s.title, description: s.description, order: s.order })
        .returning({ id: workflowTemplateStepsTable.id });
      if (!inserted) { warn(`Could not insert step "${s.title}"`); continue; }
      prodStepId = inserted.id;
    }

    idMap.set(s.id, prodStepId);
  }

  log(`  synced ${idMap.size} step(s)`);
  return idMap;
}

// ─── 3. Workflow Template Step Tasks ─────────────────────────────────────────

async function syncWorkflowTemplateStepTasks(
  stepIdMap: Map<number, number>,
): Promise<void> {
  log("\n[3/5] Syncing workflow template step tasks…");
  const devTasks = await devDb.select().from(workflowTemplateStepTasksTable);
  log(`  dev has ${devTasks.length} task(s)`);

  const prodStepIds = [...new Set([...stepIdMap.values()])];

  // Fetch ALL existing prod tasks for the affected steps in one query
  const existingProdTasks =
    prodStepIds.length > 0
      ? await prodDb
          .select()
          .from(workflowTemplateStepTasksTable)
          .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, prodStepIds))
      : [];

  // Build map: "prodStepId:order" → prod task id
  const existingMap = new Map<string, number>();
  for (const pt of existingProdTasks) {
    existingMap.set(`${pt.workflowTemplateStepId}:${pt.order}`, pt.id);
  }

  const toInsert: Array<typeof workflowTemplateStepTasksTable.$inferInsert> = [];
  const toUpdate: Array<{ id: number; title: string; description: string | null; groupName: string | null; order: number }> = [];
  let skipped = 0;

  for (const task of devTasks) {
    const prodStepId = stepIdMap.get(task.workflowTemplateStepId);
    if (!prodStepId) { skipped++; continue; }

    const key = `${prodStepId}:${task.order}`;
    const existingId = existingMap.get(key);

    if (existingId !== undefined) {
      toUpdate.push({ id: existingId, title: task.title, description: task.description, groupName: task.groupName, order: task.order });
    } else {
      toInsert.push({ workflowTemplateStepId: prodStepId, title: task.title, description: task.description, groupName: task.groupName, order: task.order });
    }
  }

  // Bulk insert new tasks in batches of 100
  const BATCH = 100;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    await prodDb.insert(workflowTemplateStepTasksTable).values(toInsert.slice(i, i + BATCH));
  }

  // Update existing tasks one-by-one (small set of changes in practice)
  for (const u of toUpdate) {
    await prodDb
      .update(workflowTemplateStepTasksTable)
      .set({ title: u.title, description: u.description, groupName: u.groupName, order: u.order })
      .where(eq(workflowTemplateStepTasksTable.id, u.id));
  }

  log(`  inserted ${toInsert.length}, updated ${toUpdate.length}, skipped ${skipped} task(s)`);
}

// ─── 4. Services (with workflowTemplateId mapped to prod IDs) ─────────────────

async function syncServices(
  templateIdMap: Map<number, number>,
): Promise<Map<number, number>> {
  log("\n[4/5] Syncing services…");
  const devServices = await devDb.select().from(servicesTable);
  log(`  dev has ${devServices.length} service(s)`);

  // devId → prodId
  const idMap = new Map<number, number>();

  const slugged = devServices.filter((s): s is typeof s & { slug: string } => s.slug !== null);
  if (slugged.length < devServices.length) {
    warn(`${devServices.length - slugged.length} service(s) have no slug and are skipped`);
  }

  for (const svc of slugged) {
    const { id: devId, createdAt: _c, ...rest } = svc;

    // Map workflowTemplateId to prod ID
    const mappedWorkflowTemplateId =
      rest.workflowTemplateId != null
        ? (templateIdMap.get(rest.workflowTemplateId) ?? null)
        : null;

    const values = { ...rest, workflowTemplateId: mappedWorkflowTemplateId };
    const { slug, ...setValues } = values;
    void slug;

    const [prod] = await prodDb
      .insert(servicesTable)
      .values(values)
      .onConflictDoUpdate({
        target: servicesTable.slug,
        set: setValues,
      })
      .returning({ id: servicesTable.id });

    if (!prod) { warn(`Could not upsert service "${svc.name}"`); continue; }
    idMap.set(devId, prod.id);
    log(`  synced service [${devId}→${prod.id}]: ${svc.name}`);
  }

  return idMap;
}

// ─── 5a. Wire workflow_templates.serviceId back to prod service IDs ───────────

async function wireWorkflowTemplateServiceIds(
  templateIdMap: Map<number, number>,
  serviceIdMap: Map<number, number>,
): Promise<void> {
  log("\n  Wiring workflow template → service back-links…");
  const devTemplates = await devDb.select().from(workflowTemplatesTable);

  for (const t of devTemplates) {
    if (t.serviceId == null) continue;
    const prodTemplateId = templateIdMap.get(t.id);
    const prodServiceId = serviceIdMap.get(t.serviceId);
    if (!prodTemplateId || !prodServiceId) {
      warn(`Cannot wire template "${t.name}": prodTemplate=${prodTemplateId} prodService=${prodServiceId}`);
      continue;
    }
    await prodDb
      .update(workflowTemplatesTable)
      .set({ serviceId: prodServiceId })
      .where(eq(workflowTemplatesTable.id, prodTemplateId));
    log(`  wired template "${t.name}" → service id ${prodServiceId}`);
  }
}

// ─── 5b. Contract Templates ───────────────────────────────────────────────────

async function syncContractTemplates(serviceIdMap: Map<number, number>): Promise<void> {
  log("\n[5a/5] Syncing contract templates…");
  const devTemplates = await devDb.select().from(contractTemplatesTable);
  log(`  dev has ${devTemplates.length} contract template(s)`);

  for (const ct of devTemplates) {
    const prodServiceId = serviceIdMap.get(ct.serviceId);
    if (!prodServiceId) {
      warn(`No prod service for contract template (dev serviceId=${ct.serviceId}) — skipping`);
      continue;
    }

    await prodDb
      .insert(contractTemplatesTable)
      .values({ serviceId: prodServiceId, body: ct.body, version: ct.version })
      .onConflictDoUpdate({
        target: contractTemplatesTable.serviceId,
        set: { body: ct.body, version: ct.version },
      });
    log(`  synced contract template for service id ${prodServiceId}`);
  }
}

// ─── 5c. Engagement Projects ──────────────────────────────────────────────────

async function syncEngagementProjects(): Promise<void> {
  log("\n[5b/5] Syncing engagement projects…");
  const devProjects = await devDb.select().from(engagementProjectsTable);
  log(`  dev has ${devProjects.length} engagement project(s)`);

  for (const ep of devProjects) {
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = ep;

    // Upsert by title
    const existing = await prodDb
      .select({ id: engagementProjectsTable.id })
      .from(engagementProjectsTable)
      .where(eq(engagementProjectsTable.title, ep.title));

    if (existing.length > 0) {
      await prodDb
        .update(engagementProjectsTable)
        .set(fields)
        .where(eq(engagementProjectsTable.title, ep.title));
    } else {
      await prodDb.insert(engagementProjectsTable).values(fields);
    }
    log(`  synced: ${ep.title}`);
  }
}

// ─── Clean up stale prod entries not present in dev ───────────────────────────

async function cleanStaleEngagementProjects(): Promise<void> {
  const devProjects = await devDb.select({ title: engagementProjectsTable.title }).from(engagementProjectsTable);
  const devTitles = devProjects.map((p) => p.title);
  if (devTitles.length === 0) return;

  const deleted = await prodDb
    .delete(engagementProjectsTable)
    .where(notInArray(engagementProjectsTable.title, devTitles))
    .returning({ title: engagementProjectsTable.title });

  if (deleted.length > 0) {
    log(`  removed ${deleted.length} stale engagement project(s) from prod`);
  }
}

async function cleanStaleWorkflowTemplates(templateIdMap: Map<number, number>): Promise<void> {
  const prodIds = [...templateIdMap.values()];
  if (prodIds.length === 0) return;

  // Remove steps (and tasks via CASCADE) for templates not in our sync
  const allProdTemplates = await prodDb.select({ id: workflowTemplatesTable.id }).from(workflowTemplatesTable);
  const staleIds = allProdTemplates.map((t) => t.id).filter((id) => !prodIds.includes(id));

  if (staleIds.length > 0) {
    await prodDb.delete(workflowTemplatesTable).where(inArray(workflowTemplatesTable.id, staleIds));
    log(`  removed ${staleIds.length} stale workflow template(s) from prod`);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("=== seed-prod: syncing catalogue data dev → production ===\n");

  const templateIdMap = await syncWorkflowTemplates();
  const stepIdMap = await syncWorkflowTemplateSteps(templateIdMap);
  await syncWorkflowTemplateStepTasks(stepIdMap);
  const serviceIdMap = await syncServices(templateIdMap);
  await wireWorkflowTemplateServiceIds(templateIdMap, serviceIdMap);
  await syncContractTemplates(serviceIdMap);
  await syncEngagementProjects();
  await cleanStaleEngagementProjects();
  await cleanStaleWorkflowTemplates(templateIdMap);

  log("\n=== Done. Production catalogue is now in sync with dev. ===");

  await devPool.end();
  await prodPool.end();
}

main().catch((err) => {
  console.error("seed-prod failed:", err);
  process.exit(1);
});
