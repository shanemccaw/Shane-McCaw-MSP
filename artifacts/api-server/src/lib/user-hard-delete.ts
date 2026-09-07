/**
 * WHAT DELETING ONE USER MEANS — the single shared implementation (Git #2984, EPIC #1944).
 *
 * This cascade was written for `DELETE /admin/active-directory/user/:id` (Issue #69) and
 * lived inside `routes/admin-active-directory.ts`, where it was reachable only from a
 * request carrying a human actor. #2984 settled that the 7-year post-termination purge
 * destroys the customer's `users` rows too — "full purge, users included… no point in
 * being hoarders" (#1944 part 7), with no cold-storage exception for identity or
 * credential data. That purge is a scheduled sweep with no human actor at all, so the
 * function moved here and its actor became a real union rather than a `{ id, email }` a
 * scheduler would have had to invent.
 *
 * There is still exactly ONE implementation. Three callers share it:
 *
 *   1. `DELETE /admin/active-directory/user/:id`         — a PlatformAdmin, dev-only.
 *   2. `DELETE /admin/active-directory/customer/:id`     — the same admin, every user
 *                                                          under one tenant, dev-only.
 *   3. `retention/purgers/modules.ts` → `identityPurger` — the scheduled 7-year purge,
 *                                                          no human actor, NOT dev-gated.
 *
 * The dev-only environment gate belongs to the two ROUTES, not to this function: a
 * scheduled retention purge is a production behaviour by design, and
 * `assertNonProductionEnvironment()` stays where it is, as the first executed line of
 * each route.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TABLE FOOTPRINT — three sections, and why each row is in the one it is
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A. EXPLICITLY DELETED in the caller's transaction, in dependency-safe order (children
 *    referencing other listed tables go first).
 *
 *    Blocking business tables (their users FK is NO ACTION → the `users` DELETE fails
 *    outright until they are gone). Where a table also carries a projects/client_services
 *    FK, rows attached to the target's projects are deleted too — otherwise the projects
 *    delete below would be blocked by rows not keyed to the target user:
 *      1. workflow_steps        (projectId → projects, clientServiceId → client_services; NO ACTION.
 *                                NOT keyed to users at all — absent from Issue #69's users-FK
 *                                audit but REQUIRED: it blocks deleting the user's projects/services)
 *      2. kanban_tasks          (projectId → projects; NO ACTION. Same second-order case as above)
 *      3. status_reports        (clientUserId; + projectId → projects)
 *      4. project_updates       (authorUserId; + projectId → projects)
 *      5. messages              (clientUserId, senderUserId)
 *      6. notifications         (userId)
 *      7. reports               (clientUserId; + projectId → projects)
 *      8. client_documents      (uploadedBy NO ACTION; clientUserId already cascades)
 *      9. documents             (uploadedBy; + projectId → projects)
 *     10. invoices              (clientUserId; + projectId → projects)
 *     11. contracts             (userId; + projectId → projects)
 *     12. emails                (linkedUserId; linkedProjectId is set-null — DB handles)
 *     13. email_domain_rules    (linkedUserId)
 *     14. password_reset_tokens (userId)
 *     15. impersonation_tokens  (clientUserId, adminUserId)
 *
 *    Four more NO ACTION edges into users(id), found by #2984's live `pg_constraint`
 *    sweep and missing from every earlier revision of this list. Each of them made the
 *    whole transaction throw for any user that happened to hold such a row — filed as
 *    its own finding, fixed here:
 *     16. signup_exchange_tokens  (userId, NOT NULL — the login's own one-shot signup token)
 *     17. print_tokens            (userId, NOT NULL — the login's own short-lived print token)
 *     18. document_print_tokens   (userId, NOT NULL — same, for the live-rendered document set)
 *     19. checkout_sessions       (accountUserId — the signup attempt that minted this login.
 *                                  The tenant-keyed checkout rows belong to the commercial
 *                                  purger; THIS column is the login's own, and being cleared
 *                                  only in the route's post-commit Phase B meant it could
 *                                  never unblock the users DELETE that ran before it.)
 *
 *    …plus one that is NOT a delete. `customer_alert_settings.updated_by_user_id` is a
 *    nullable ATTRIBUTION column on a row keyed to the TENANT, so deleting the row
 *    because of who last edited it would destroy a settings row that is not this user's.
 *    It is NULLED instead — the same call section C makes, made in code because this one
 *    FK is NO ACTION where every sibling attribution column in the schema is SET NULL.
 *
 *     20. client_services       (clientUserId; + projectId → projects — before projects)
 *     21. projects              (clientUserId, signedOffBy — after every project child above)
 *
 *    Original AD-era list (Issue #69). Five of these now carry onDelete: "cascade" on
 *    their users FK (mfa_enrollments, mfa_challenges, mfa_bypass_codes, user_sessions,
 *    user_entitlement_overrides) — they are still deleted explicitly, per that issue's
 *    final decision, so the wipe is explicit and auditable rather than implicit:
 *     22. mfa_enrollments             (userId)
 *     23. mfa_challenges              (userId)
 *     24. mfa_bypass_codes            (userId; createdByUserId elsewhere is set-null — DB handles)
 *     25. user_sessions               (userId)
 *     26. user_entitlement_overrides  (userId; grantedByUserId elsewhere set-null — DB handles)
 *
 *    Tenant-scoped wipe (post-#92 these carry NO users FK — loose integer/text columns;
 *    "delete removes everything about them including consent, and any tenant telemetry we
 *    have" per Shane. Keyed by the target's owning tenants row; skipped when the account
 *    has no tenant linkage):
 *     27. consent_invite_tokens       (clientUserId; tenant customerId/tenantId)
 *     28. insights_generated_documents(customerId = users.id owner; mspCustomerId = tenant)
 *     29. tenant_monitor_profiles     (tenantId = the tenant's AAD GUID)
 *     30. msp_diagnostic_findings     (runId of the runs below; customerId = tenant)
 *     31. msp_diagnostic_runs         (triggeredByUserId; customerId = tenant)
 *     32. msp_customer_clickwraps     (customerUserId; customerId = tenant)
 *     33. msp_agreement_acceptances   (userId — loose column, no FK)
 *     34. live_document_shares        (customerId = users.id, NOT NULL, NO ACTION — #2983)
 *     35. msp_impersonation_tokens    (actorUserId, targetUserId — loose columns)
 *     36. users — the account row itself, last.
 *
 * B. DB AUTO-CASCADE (onDelete: "cascade" — counted in the pre-delete census, NOT deleted
 *    here; the users delete removes them): customer_notification_preferences,
 *    account_setup_tokens, client_m365_profiles, client_app_registrations,
 *    webauthn_credentials, webauthn_challenges, client_health_history,
 *    client_callback_tokens, client_scores, client_automation_runs,
 *    assessment_sow_agreements, push_subscriptions, quick_win_presentations,
 *    quick_win_result_shares, msp_staff_customer_scopes (+ the five overlap tables in A).
 *
 * C. DB AUTO-SET-NULL (onDelete: "set null" — reference nulled, row SURVIVES).
 *
 *    #2984 settled what this means for a FULL purge, and the answer is the same one
 *    Issue #69 reached for a single admin delete, for a reason worth stating plainly:
 *    **the audit row survives, its actor attribution does not.** A "full purge, users
 *    included" that left `audit_logs.actor_user_id` pointing at a person would be
 *    retaining that identity by another name — the account is genuinely gone, and an
 *    audit trail naming a deleted person is a different, false kind of retention. #1944
 *    part 2's guarantee is that the ACCOUNT of what happened is permanent, not that the
 *    person named in it is.
 *
 *    Nothing in this function performs those nulls: the `users` DELETE does, via the real
 *    ON DELETE SET NULL actions in the database. They are CENSUSED before the delete so
 *    the permanent audit line records how many attributions were blanked — the columns
 *    are project_closures.signer_user_id, audit_logs.actor_user_id, audit_logs.client_id,
 *    mfa_bypass_codes.created_by_user_id, azure_tenant_credentials.client_user_id,
 *    inbox_message_links.customer_id, script_run_results.customer_id,
 *    script_download_tokens.customer_id, insights_automations.customer_id,
 *    tenant_signal_history.client_user_id, sales_offer_events.actor_user_id,
 *    user_entitlement_overrides.granted_by_user_id,
 *    msp_staff_customer_scopes.created_by_user_id, and users.manager_user_id (a
 *    self-reference, which is why deleting a manager and the people they manage in one
 *    loop works in any order).
 *
 * The FULL pre-delete state (row counts for every table in A, B and C) is logged to the
 * `audit` channel BEFORE the caller's transaction can commit.
 */

import {
  db,
  usersTable,
  tenantsTable,
  projectsTable,
  workflowStepsTable,
  kanbanTasksTable,
  documentsTable,
  reportsTable,
  invoicesTable,
  messagesTable,
  notificationsTable,
  projectUpdatesTable,
  contractsTable,
  statusReportsTable,
  emailsTable,
  emailDomainRulesTable,
  clientDocumentsTable,
  clientServicesTable,
  passwordResetTokensTable,
  impersonationTokensTable,
  signupExchangeTokensTable,
  printTokensTable,
  documentPrintTokensTable,
  checkoutSessionsTable,
  customerAlertSettingsTable,
  mfaEnrollmentsTable,
  mfaChallengesTable,
  mfaBypassCodesTable,
  userSessionsTable,
  userEntitlementOverridesTable,
  consentInviteTokensTable,
  insightsGeneratedDocumentsTable,
  tenantMonitorProfilesTable,
  mspDiagnosticFindingsTable,
  mspDiagnosticRunsTable,
  mspCustomerClickwrapsTable,
  mspAgreementAcceptancesTable,
  liveDocumentSharesTable,
  mspImpersonationTokensTable,
  // ── Section B: DB auto-cascade, censused only ─────────────────────────────
  customerNotificationPreferencesTable,
  accountSetupTokensTable,
  clientM365ProfilesTable,
  clientAppRegistrationsTable,
  webauthnCredentialsTable,
  webauthnChallengesTable,
  clientHealthHistoryTable,
  clientCallbackTokensTable,
  clientScoresTable,
  clientAutomationRunsTable,
  assessmentSowAgreementsTable,
  pushSubscriptionsTable,
  quickWinPresentationsTable,
  quickWinResultSharesTable,
  mspStaffCustomerScopesTable,
  // ── Section C: DB auto-set-null, censused only ────────────────────────────
  projectClosuresTable,
  auditLogsTable,
  azureTenantCredentialsTable,
  inboxMessageLinksTable,
  scriptRunResultsTable,
  scriptDownloadTokensTable,
  insightsAutomationsTable,
  tenantSignalHistoryTable,
  salesOfferEventsTable,
} from "@workspace/db";
import type { PgTable } from "drizzle-orm/pg-core";
import { eq, or, inArray, count, type SQL } from "drizzle-orm";
import { logger } from "./logger";

const auditLog = logger.child({ channel: "audit" });

/**
 * The transaction handle `db.transaction()`'s callback receives. Typed off the real
 * driver rather than restated, so it cannot drift — and identical, by construction, to
 * `retention/registry.ts`'s `RetentionTx`, which is how the retention purger passes its
 * own open transaction straight in.
 */
export type UserHardDeleteTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Who is destroying this account.
 *
 * A union rather than `{ id, email }`, because the scheduled purge genuinely has no human
 * actor and the alternative — a synthetic user id, or a `0`/`-1` sentinel written into a
 * permanent audit line — records something that is not true. `"system"` says exactly what
 * happened: nobody clicked anything, a retention window expired.
 */
export type UserHardDeleteActor =
  | { kind: "user"; id: number; email: string }
  | {
      kind: "system";
      /** The real automated process, e.g. `"retention.post_termination_purge"`. */
      process: string;
      /** Why it ran now, e.g. `"post_termination_window_expired"`. */
      reason: string;
    };

export type UserHardDeleteResult =
  | { notFound: true }
  | {
      notFound: false;
      target: {
        id: number;
        email: string;
        name: string | null;
        mspRole: string;
        mspId: number | null;
        tenantId: number | null;
      };
      tenant: { id: number; tenantGuid: string } | null;
      explicitCounts: Record<string, number>;
      cascadeCounts: Record<string, number>;
      /** Attribution references the `users` DELETE blanks — the rows themselves survive. */
      setNullCounts: Record<string, number>;
    };

/** The actor fields every audit line this function writes carries. */
function actorFields(actor: UserHardDeleteActor): Record<string, unknown> {
  return actor.kind === "user"
    ? { actorKind: "user", actorUserId: actor.id, actorEmail: actor.email }
    : {
        actorKind: "system",
        actorUserId: null,
        actorEmail: null,
        actorProcess: actor.process,
        actorReason: actor.reason,
      };
}

/**
 * The full per-user cascade documented above. Must run inside an already-open
 * transaction; the caller owns commit/rollback, so a failure anywhere leaves the account
 * and every row belonging to it exactly as they were.
 *
 * Emits one `audit`-channel pre-state line per user, so a tenant-wide delete produces one
 * such line per account it removes.
 */
export async function hardDeleteUserWithinTx(
  tx: UserHardDeleteTx,
  userId: number,
  actor: UserHardDeleteActor,
): Promise<UserHardDeleteResult> {
  const [target] = await tx
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: usersTable.mspRole,
          mspId: usersTable.mspId,
          tenantId: usersTable.tenantId,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!target) return { notFound: true as const };

      // The owning tenants row keys the tenant-scoped wipe (section A,
      // 23-28). tenants.id is the integer "customerId" successor id-space;
      // tenants.tenantId is the AAD GUID text key telemetry rows carry.
      const tenant =
        target.tenantId != null
          ? ((
              await tx
                .select({ id: tenantsTable.id, tenantGuid: tenantsTable.tenantId })
                .from(tenantsTable)
                .where(eq(tenantsTable.id, target.tenantId))
                .limit(1)
            )[0] ?? null)
          : null;

      const projectIds = (
        await tx
          .select({ id: projectsTable.id })
          .from(projectsTable)
          .where(or(eq(projectsTable.clientUserId, userId), eq(projectsTable.signedOffBy, userId)))
      ).map((r) => r.id);

      const clientServiceIds = (
        await tx
          .select({ id: clientServicesTable.id })
          .from(clientServicesTable)
          .where(
            or(
              eq(clientServicesTable.clientUserId, userId),
              projectIds.length ? inArray(clientServicesTable.projectId, projectIds) : undefined,
            ),
          )
      ).map((r) => r.id);

      const diagnosticRunIds = (
        await tx
          .select({ runId: mspDiagnosticRunsTable.runId })
          .from(mspDiagnosticRunsTable)
          .where(
            or(
              eq(mspDiagnosticRunsTable.triggeredByUserId, userId),
              tenant ? eq(mspDiagnosticRunsTable.customerId, tenant.id) : undefined,
            ),
          )
      ).map((r) => r.runId);

      // or() over the real conditions only; null means "no rows can match —
      // skip this table entirely" (e.g. tenant-scoped tables for an account
      // with no tenant linkage). NEVER pass an undefined where to delete().
      const anyOf = (...conds: (SQL | undefined)[]): SQL | null => {
        const real = conds.filter((c): c is SQL => c !== undefined);
        return real.length ? (or(...real) as SQL) : null;
      };

      // Section A of the header comment, in that exact order.
      const explicitDeletes: Array<{ name: string; table: PgTable; where: SQL | null }> = [
        {
          name: "workflow_steps",
          table: workflowStepsTable,
          where: anyOf(
            projectIds.length ? inArray(workflowStepsTable.projectId, projectIds) : undefined,
            clientServiceIds.length ? inArray(workflowStepsTable.clientServiceId, clientServiceIds) : undefined,
          ),
        },
        {
          name: "kanban_tasks",
          table: kanbanTasksTable,
          where: anyOf(projectIds.length ? inArray(kanbanTasksTable.projectId, projectIds) : undefined),
        },
        {
          name: "status_reports",
          table: statusReportsTable,
          where: anyOf(
            eq(statusReportsTable.clientUserId, userId),
            projectIds.length ? inArray(statusReportsTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "project_updates",
          table: projectUpdatesTable,
          where: anyOf(
            eq(projectUpdatesTable.authorUserId, userId),
            projectIds.length ? inArray(projectUpdatesTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "messages",
          table: messagesTable,
          where: anyOf(eq(messagesTable.clientUserId, userId), eq(messagesTable.senderUserId, userId)),
        },
        { name: "notifications", table: notificationsTable, where: anyOf(eq(notificationsTable.userId, userId)) },
        {
          name: "reports",
          table: reportsTable,
          where: anyOf(
            eq(reportsTable.clientUserId, userId),
            projectIds.length ? inArray(reportsTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "client_documents",
          table: clientDocumentsTable,
          where: anyOf(eq(clientDocumentsTable.clientUserId, userId), eq(clientDocumentsTable.uploadedBy, userId)),
        },
        {
          name: "documents",
          table: documentsTable,
          where: anyOf(
            eq(documentsTable.uploadedBy, userId),
            projectIds.length ? inArray(documentsTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "invoices",
          table: invoicesTable,
          where: anyOf(
            eq(invoicesTable.clientUserId, userId),
            projectIds.length ? inArray(invoicesTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "contracts",
          table: contractsTable,
          where: anyOf(
            eq(contractsTable.userId, userId),
            projectIds.length ? inArray(contractsTable.projectId, projectIds) : undefined,
          ),
        },
        { name: "emails", table: emailsTable, where: anyOf(eq(emailsTable.linkedUserId, userId)) },
        { name: "email_domain_rules", table: emailDomainRulesTable, where: anyOf(eq(emailDomainRulesTable.linkedUserId, userId)) },
        { name: "password_reset_tokens", table: passwordResetTokensTable, where: anyOf(eq(passwordResetTokensTable.userId, userId)) },
        {
          name: "impersonation_tokens",
          table: impersonationTokensTable,
          where: anyOf(eq(impersonationTokensTable.clientUserId, userId), eq(impersonationTokensTable.adminUserId, userId)),
        },
        // ── The four NO ACTION edges #2984's live pg_constraint sweep found missing.
        //    Every one of them aborted the whole transaction for any user holding such a
        //    row, which is why the users DELETE below could never have run for a real
        //    account that had signed up, printed a document, or minted a print token. ──
        { name: "signup_exchange_tokens", table: signupExchangeTokensTable, where: anyOf(eq(signupExchangeTokensTable.userId, userId)) },
        { name: "print_tokens", table: printTokensTable, where: anyOf(eq(printTokensTable.userId, userId)) },
        { name: "document_print_tokens", table: documentPrintTokensTable, where: anyOf(eq(documentPrintTokensTable.userId, userId)) },
        { name: "checkout_sessions", table: checkoutSessionsTable, where: anyOf(eq(checkoutSessionsTable.accountUserId, userId)) },
        {
          name: "client_services",
          table: clientServicesTable,
          where: anyOf(
            eq(clientServicesTable.clientUserId, userId),
            projectIds.length ? inArray(clientServicesTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "projects",
          table: projectsTable,
          where: anyOf(eq(projectsTable.clientUserId, userId), eq(projectsTable.signedOffBy, userId)),
        },
        { name: "mfa_enrollments", table: mfaEnrollmentsTable, where: anyOf(eq(mfaEnrollmentsTable.userId, userId)) },
        { name: "mfa_challenges", table: mfaChallengesTable, where: anyOf(eq(mfaChallengesTable.userId, userId)) },
        { name: "mfa_bypass_codes", table: mfaBypassCodesTable, where: anyOf(eq(mfaBypassCodesTable.userId, userId)) },
        { name: "user_sessions", table: userSessionsTable, where: anyOf(eq(userSessionsTable.userId, userId)) },
        {
          name: "user_entitlement_overrides",
          table: userEntitlementOverridesTable,
          where: anyOf(eq(userEntitlementOverridesTable.userId, userId)),
        },
        {
          name: "consent_invite_tokens",
          table: consentInviteTokensTable,
          where: anyOf(
            eq(consentInviteTokensTable.clientUserId, userId),
            tenant ? eq(consentInviteTokensTable.customerId, tenant.id) : undefined,
            tenant ? eq(consentInviteTokensTable.tenantId, tenant.tenantGuid) : undefined,
          ),
        },
        {
          name: "insights_generated_documents",
          table: insightsGeneratedDocumentsTable,
          where: anyOf(
            eq(insightsGeneratedDocumentsTable.customerId, userId),
            tenant ? eq(insightsGeneratedDocumentsTable.mspCustomerId, tenant.id) : undefined,
          ),
        },
        {
          name: "tenant_monitor_profiles",
          table: tenantMonitorProfilesTable,
          where: anyOf(tenant ? eq(tenantMonitorProfilesTable.tenantId, tenant.tenantGuid) : undefined),
        },
        {
          name: "msp_diagnostic_findings",
          table: mspDiagnosticFindingsTable,
          where: anyOf(
            diagnosticRunIds.length ? inArray(mspDiagnosticFindingsTable.runId, diagnosticRunIds) : undefined,
            tenant ? eq(mspDiagnosticFindingsTable.customerId, tenant.id) : undefined,
          ),
        },
        {
          name: "msp_diagnostic_runs",
          table: mspDiagnosticRunsTable,
          where: anyOf(
            eq(mspDiagnosticRunsTable.triggeredByUserId, userId),
            tenant ? eq(mspDiagnosticRunsTable.customerId, tenant.id) : undefined,
          ),
        },
        {
          name: "msp_customer_clickwraps",
          table: mspCustomerClickwrapsTable,
          where: anyOf(
            eq(mspCustomerClickwrapsTable.customerUserId, userId),
            tenant ? eq(mspCustomerClickwrapsTable.customerId, tenant.id) : undefined,
          ),
        },
        { name: "msp_agreement_acceptances", table: mspAgreementAcceptancesTable, where: anyOf(eq(mspAgreementAcceptancesTable.userId, userId)) },
        // live_document_shares.customer_id is a NOT NULL users.id whose FK is NO
        // ACTION — so a user who ever minted a share link could not be hard
        // deleted at all: the users DELETE failed on the constraint and rolled
        // the whole transaction back. Found by the #2983 id-space audit; the
        // share is the login's own credential, so it goes with the login.
        { name: "live_document_shares", table: liveDocumentSharesTable, where: anyOf(eq(liveDocumentSharesTable.customerId, userId)) },
        {
          name: "msp_impersonation_tokens",
          table: mspImpersonationTokensTable,
          where: anyOf(eq(mspImpersonationTokensTable.actorUserId, userId), eq(mspImpersonationTokensTable.targetUserId, userId)),
        },
      ];

      // Section B — rows the users delete will cascade away (census only).
      const cascadeCensus: Array<{ name: string; table: PgTable; where: SQL }> = [
        { name: "customer_notification_preferences", table: customerNotificationPreferencesTable, where: eq(customerNotificationPreferencesTable.userId, userId) },
        { name: "account_setup_tokens", table: accountSetupTokensTable, where: eq(accountSetupTokensTable.userId, userId) },
        { name: "client_m365_profiles", table: clientM365ProfilesTable, where: eq(clientM365ProfilesTable.clientId, userId) },
        { name: "client_app_registrations", table: clientAppRegistrationsTable, where: eq(clientAppRegistrationsTable.clientUserId, userId) },
        { name: "webauthn_credentials", table: webauthnCredentialsTable, where: eq(webauthnCredentialsTable.userId, userId) },
        { name: "webauthn_challenges", table: webauthnChallengesTable, where: eq(webauthnChallengesTable.userId, userId) },
        { name: "client_health_history", table: clientHealthHistoryTable, where: eq(clientHealthHistoryTable.clientId, userId) },
        { name: "client_callback_tokens", table: clientCallbackTokensTable, where: eq(clientCallbackTokensTable.clientUserId, userId) },
        { name: "client_scores", table: clientScoresTable, where: eq(clientScoresTable.clientId, userId) },
        { name: "client_automation_runs", table: clientAutomationRunsTable, where: eq(clientAutomationRunsTable.clientUserId, userId) },
        { name: "assessment_sow_agreements", table: assessmentSowAgreementsTable, where: eq(assessmentSowAgreementsTable.clientUserId, userId) },
        { name: "push_subscriptions", table: pushSubscriptionsTable, where: eq(pushSubscriptionsTable.userId, userId) },
        { name: "quick_win_presentations", table: quickWinPresentationsTable, where: eq(quickWinPresentationsTable.clientUserId, userId) },
        { name: "quick_win_result_shares", table: quickWinResultSharesTable, where: eq(quickWinResultSharesTable.clientUserId, userId) },
        { name: "msp_staff_customer_scopes", table: mspStaffCustomerScopesTable, where: eq(mspStaffCustomerScopesTable.staffUserId, userId) },
      ];

      // Section C — references the users delete will null out; rows survive.
      const setNullCensus: Array<{ name: string; table: PgTable; where: SQL }> = [
        { name: "project_closures.signer_user_id", table: projectClosuresTable, where: eq(projectClosuresTable.signerUserId, userId) },
        { name: "audit_logs.actor_user_id", table: auditLogsTable, where: eq(auditLogsTable.actorUserId, userId) },
        { name: "audit_logs.client_id", table: auditLogsTable, where: eq(auditLogsTable.clientId, userId) },
        { name: "mfa_bypass_codes.created_by_user_id", table: mfaBypassCodesTable, where: eq(mfaBypassCodesTable.createdByUserId, userId) },
        { name: "azure_tenant_credentials.client_user_id", table: azureTenantCredentialsTable, where: eq(azureTenantCredentialsTable.clientUserId, userId) },
        { name: "inbox_message_links.customer_id", table: inboxMessageLinksTable, where: eq(inboxMessageLinksTable.customerId, userId) },
        { name: "script_run_results.customer_id", table: scriptRunResultsTable, where: eq(scriptRunResultsTable.customerId, userId) },
        { name: "script_download_tokens.customer_id", table: scriptDownloadTokensTable, where: eq(scriptDownloadTokensTable.customerId, userId) },
        // client_user_id dropped (Git #3079) — dead column, never written by any real path.
        { name: "insights_automations.customer_id", table: insightsAutomationsTable, where: eq(insightsAutomationsTable.customerId, userId) },
        // #2983: tenant_signal_history.customer_id is a real tenants.id now, so a
        // single user's delete must NOT filter on it (that is the tenant-only
        // cascade's job). What a user delete does touch is the retained
        // pre-#2983 provenance column, which is a users.id and is SET NULL.
        { name: "tenant_signal_history.client_user_id", table: tenantSignalHistoryTable, where: eq(tenantSignalHistoryTable.clientUserId, userId) },
        // sales_offers.customer_id is a tenants.id, not a users.id (#2730) — a
        // single user's hard delete never nulls it (deleting the whole tenant
        // does, via /admin/active-directory/customer/:id's own cascade). Not
        // listed here; a `userId` value would filter the wrong id space.
        { name: "sales_offer_events.actor_user_id", table: salesOfferEventsTable, where: eq(salesOfferEventsTable.actorUserId, userId) },
        { name: "user_entitlement_overrides.granted_by_user_id", table: userEntitlementOverridesTable, where: eq(userEntitlementOverridesTable.grantedByUserId, userId) },
        { name: "msp_staff_customer_scopes.created_by_user_id", table: mspStaffCustomerScopesTable, where: eq(mspStaffCustomerScopesTable.createdByUserId, userId) },
        // Blanked by this function rather than by the DB — its FK is NO ACTION where
        // every sibling attribution column above is SET NULL (#2984 finding). Censused
        // here because the OUTCOME is identical: the tenant's settings row survives,
        // unattributed.
        { name: "customer_alert_settings.updated_by_user_id", table: customerAlertSettingsTable, where: eq(customerAlertSettingsTable.updatedByUserId, userId) },
      ];

      const countWhere = async (table: PgTable, where: SQL): Promise<number> => {
        const [row] = await tx.select({ n: count() }).from(table).where(where);
        return Number(row?.n ?? 0);
      };

      const explicitCounts: Record<string, number> = {};
      for (const entry of explicitDeletes) {
        explicitCounts[entry.name] = entry.where ? await countWhere(entry.table, entry.where) : 0;
      }
      const cascadeCounts: Record<string, number> = {};
      for (const entry of cascadeCensus) {
        cascadeCounts[entry.name] = await countWhere(entry.table, entry.where);
      }
      const setNullCounts: Record<string, number> = {};
      for (const entry of setNullCensus) {
        setNullCounts[entry.name] = await countWhere(entry.table, entry.where);
      }

      // The FULL pre-delete state, to the audit channel, BEFORE anything is
      // deleted and therefore before the transaction can possibly commit.
      auditLog.info(
        {
          actionType: "user.hard_delete.pre_state",
          ...actorFields(actor),
          targetUserId: target.id,
          targetEmail: target.email,
          targetMspRole: target.mspRole,
          targetMspId: target.mspId,
          targetTenantId: target.tenantId,
          tenantGuid: tenant?.tenantGuid ?? null,
          projectIds,
          clientServiceIds,
          diagnosticRunIds,
          explicitDeleteCounts: explicitCounts,
          dbCascadeCounts: cascadeCounts,
          dbSetNullCounts: setNullCounts,
          occurredAt: new Date().toISOString(),
        },
        "audit: FULL pre-delete state for a user hard delete (logged before commit)",
      );

      for (const entry of explicitDeletes) {
        if (entry.where) await tx.delete(entry.table).where(entry.where);
      }

      // The one attribution the DB will NOT blank for us — see section A's closing note
      // and section C. Runs before the users DELETE, which would otherwise fail on this
      // NO ACTION constraint, and leaves the tenant's own settings row in place.
      await tx
        .update(customerAlertSettingsTable)
        .set({ updatedByUserId: null })
        .where(eq(customerAlertSettingsTable.updatedByUserId, userId));

      // Last: the account row itself. The DB cascades section B and nulls
      // section C as part of this statement.
      await tx.delete(usersTable).where(eq(usersTable.id, userId));

  return { notFound: false, target, tenant, explicitCounts, cascadeCounts, setNullCounts };
}
