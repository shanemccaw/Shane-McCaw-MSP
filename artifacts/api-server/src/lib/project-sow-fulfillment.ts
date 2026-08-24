/**
 * project-sow-fulfillment.ts
 *
 * Fulfillment for an accepted Project Work sales offer (Git #1171).
 *
 * The 37 Project Work catalog rows (services.service_class = 'project', all
 * carrying fulfillment_type_key = 'project_sow') are NOT a browse-and-buy
 * catalog. They are surfaced as Sales Offer Engine offers when a monitoring
 * scan's findings warrant one — the same scan-findings -> offer shape the
 * Engagement Offer flow already uses. sales-offer-engine.ts's eligibility rule
 * groups reference the project services (2026-08-08-...-585.sql wired the
 * project rows into that engine), so a fired signal makes a project surface as
 * a candidate and, once persisted, an offer.
 *
 * Until this module, accepting such an offer (portal-offers.ts /accept) only
 * flipped the offer to `accepted` and recorded offer.accepted in the
 * sales_offer_events AUDIT log — nothing produced the actual engagement. The
 * migration-declared `fulfillment.project_sow` workflow event had, and still
 * has, zero subscribers (resolve-fulfillment.ts emits into a void), which is the
 * gap #1171 identified.
 *
 * WHAT THIS DOES — and deliberately does NOT do:
 *   - It reuses the PROVEN document-engine-sow.ts pipeline: AI-priced lines
 *     bound to the tenant's real findings via the Sales Offer Engine, gated by
 *     the same claim-binding audit as the live Copilot Readiness SOW.
 *   - It does NOT build a second SOW engine, and it is NOT the flat
 *     catalog-price HTML that msp-sow.ts's own local generateSowDocument()
 *     produces on the MSP-operator path.
 *
 * generateSowDocument() takes NO fixed-scope purchase as input — that was
 * confirmed before building this (its candidates and pricing come solely from
 * runSalesOfferEngineForTenant(), narrowed only by selectedWorkstreamTitles).
 * So the accepted offer is expressed to the engine as a title narrowing, not as
 * a price. The catalog price on the row is a floor/reference the AI-priced offer
 * anchors against, per #1171 — the SOW is priced by the fresh engine run, not
 * the frozen offer amount.
 */

import { db, salesOffersTable, servicesTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateSowDocument } from "./document-engine-sow";
import { resolveCustomerPortalUserId } from "./tenant-signals";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.doc-pipeline" });

/** The pipeline_output document type generateSowDocument() produces. */
const SOW_DOC_TYPE = "sow";

/** services.service_class value that gates the SOW-generated engagement path. */
const PROJECT_SERVICE_CLASS = "project";

export type ProjectSowFulfillmentStatus =
  /** Real path taken: project row created and SOW generation kicked off. */
  | "sow_generating"
  /** Offer's service is add_on/subscription — fulfilled by its own path, not here. */
  | "not_a_project"
  /** Offer carries no serviceId — nothing to classify. */
  | "no_service"
  /** Offer has no customerId (tenant) — the engine is tenant-scoped, cannot run. */
  | "no_customer"
  /** Customer has no portal user to own the projects.clientUserId row. */
  | "no_owner"
  /** projects insert returned no row. */
  | "project_create_failed"
  /** No sales_offers row for the given id. */
  | "offer_not_found";

export interface ProjectSowFulfillmentResult {
  status: ProjectSowFulfillmentStatus;
  projectId?: number;
  documentId?: number;
}

/**
 * Given an already-accepted sales offer, if it is a Project Work (project-class)
 * offer, create the real engagement project row and generate its Statement of
 * Work via document-engine-sow.ts.
 *
 * Designed to be called fire-and-forget from the accept handler: the offer is
 * already `accepted` by the time this runs, so any soft outcome here is returned
 * as a status and logged rather than thrown — a fulfillment problem must never
 * turn a completed acceptance into an error. It only rejects if the DB itself
 * errors; callers should still `.catch()` it.
 */
export async function fulfillAcceptedProjectOffer(opts: {
  offerId: number;
  /** The accepting customer user (users.id), when known — owns the project row. */
  acceptedByUserId?: number | null;
}): Promise<ProjectSowFulfillmentResult> {
  const { offerId, acceptedByUserId } = opts;

  const [offer] = await db
    .select({
      id: salesOffersTable.id,
      serviceId: salesOffersTable.serviceId,
      customerId: salesOffersTable.customerId,
      title: salesOffersTable.title,
    })
    .from(salesOffersTable)
    .where(eq(salesOffersTable.id, offerId))
    .limit(1);

  if (!offer) {
    log.warn({ offerId }, "project-sow-fulfillment: offer not found");
    return { status: "offer_not_found" };
  }

  if (offer.serviceId == null) {
    log.info({ offerId }, "project-sow-fulfillment: offer has no serviceId — nothing to fulfill");
    return { status: "no_service" };
  }

  const [service] = await db
    .select({
      name: servicesTable.name,
      description: servicesTable.description,
      serviceClass: servicesTable.serviceClass,
    })
    .from(servicesTable)
    .where(eq(servicesTable.id, offer.serviceId))
    .limit(1);

  if (!service || service.serviceClass !== PROJECT_SERVICE_CLASS) {
    // add_on / subscription offers fulfill through their own direct-checkout
    // paths, not the SOW-gated project engagement. This module owns only the
    // project class.
    log.info(
      { offerId, serviceId: offer.serviceId, serviceClass: service?.serviceClass ?? null },
      "project-sow-fulfillment: offer is not a project-class service — no SOW engagement",
    );
    return { status: "not_a_project" };
  }

  // The engine is tenant-scoped: mspCustomerId is required and IS a tenants.id.
  if (offer.customerId == null) {
    log.warn({ offerId }, "project-sow-fulfillment: project offer has no customerId — cannot scope the SOW engine");
    return { status: "no_customer" };
  }
  const mspCustomerId = offer.customerId;

  // projects.clientUserId is a users.id. Prefer the login that accepted; fall
  // back to the customer's canonical active portal user. sales_offers.customerId
  // is a tenants.id (the engine customer, == generateSowDocument's mspCustomerId)
  // — the two id-spaces must never be crossed, so the owner is resolved via the
  // canonical customer -> portal-user resolver, never by reusing the tenant id.
  const ownerUserId = acceptedByUserId ?? (await resolveCustomerPortalUserId(mspCustomerId));

  if (ownerUserId == null) {
    log.warn(
      { offerId, customerId: mspCustomerId },
      "project-sow-fulfillment: no portal user to own the project — SOW not generated",
    );
    return { status: "no_owner" };
  }

  // Create the real engagement project. projectType 'project' (not 'retainer' /
  // 'quick_win'); status defaults to 'active'. Title is the clean service name,
  // not the offer's "— recommended for your environment" candidate title.
  const [project] = await db
    .insert(projectsTable)
    .values({
      title: service.name,
      description: service.description ?? null,
      clientUserId: ownerUserId,
      projectType: "project",
    })
    .returning({ id: projectsTable.id });

  if (!project) {
    log.error({ offerId, mspCustomerId }, "project-sow-fulfillment: failed to create project row — SOW not generated");
    return { status: "project_create_failed" };
  }
  const projectId = project.id;

  // Generate the SOW via the proven engine. onRowCreated resolves this promise
  // as soon as the "generating" placeholder row exists (fast), so the caller is
  // not held for the multi-second AI generation — which continues on the void'd
  // chain below, exactly like portal-assessment.ts's rescope path. A generation
  // failure is logged and swallowed: the offer is already accepted and the
  // project already exists, so it must not surface as an error here.
  //
  // selectedWorkstreamTitles narrows the Sales Offer Engine's re-derived
  // candidate set to the ONE the customer accepted — the offer's stored title
  // equals the candidate's title (both `${service.name} — recommended for your
  // environment`), which is exactly what the engine filters on. If a later scan
  // has moved the signals so that candidate no longer surfaces, the SOW honestly
  // reports no scoped candidates rather than inventing one. forceRegenerate
  // skips the drift-reuse gate so acceptance always produces this project's own
  // SOW.
  let capturedDocId: number | undefined;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    void generateSowDocument({
      mspCustomerId,
      documentOwnerUserId: ownerUserId,
      projectId,
      docTypeKey: SOW_DOC_TYPE,
      selectedWorkstreamTitles: [offer.title],
      forceRegenerate: true,
      onRowCreated: (docId) => { capturedDocId = docId; done(); },
    })
      .then((r) => { capturedDocId = r.documentId; done(); })
      .catch((err) => {
        log.error({ err, offerId, projectId }, "project-sow-fulfillment: background SOW generation failed");
        done();
      });
  });

  log.info(
    { offerId, projectId, documentId: capturedDocId, ownerUserId, customerId: mspCustomerId },
    "project-sow-fulfillment: project created and SOW generation kicked off from accepted offer",
  );

  return { status: "sow_generating", projectId, documentId: capturedDocId };
}
