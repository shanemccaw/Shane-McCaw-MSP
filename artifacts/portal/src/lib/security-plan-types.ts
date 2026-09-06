/**
 * Wire types for the customer-facing Security Plan (#3027, Feature #1495).
 *
 * Mirrored verbatim from the real routes' own interfaces — see
 * `docs/security-plan-contract-pack.md` and
 * `artifacts/api-server/src/routes/portal-security-plan.ts` /
 * `portal-security-plan-document.ts`. This module has no shared wire-types
 * package to import from (each `artifacts/*` app is its own independent
 * Vite/Node app), so these are a local copy, not a redeclaration of a
 * different shape.
 */

/** One assembled row in a uniform, honest shape — `security-plan-assembly.ts`'s
 * `SecurityPlanAssembledItem`. `state`/`detail` are each source module's own
 * vocabulary, never mapped onto a shared scale (contract pack §4). */
export interface SecurityPlanAssembledItem {
  readonly id: string;
  readonly title: string;
  readonly state: string | null;
  readonly detail: string | null;
  readonly pillar: string | null;
  readonly framework: string | null;
  readonly businessUnit: string | null;
}

/** One source module's contribution — real rows read from that module's own table. */
export interface SecurityPlanAssembledModule {
  readonly key: string;
  readonly label: string;
  readonly sourceIssue: string;
  readonly total: number;
  readonly excludedCount: number;
  readonly items: readonly SecurityPlanAssembledItem[];
}

export type SecurityPlanScopeDimension = "pillar" | "framework" | "businessUnit";

export interface SecurityPlanScope {
  readonly dimensions: Partial<Record<SecurityPlanScopeDimension, readonly string[]>>;
  readonly statement?: string;
}

export interface SecurityPlanModuleExclusion {
  readonly moduleKey: string;
  readonly excludedCount: number;
}

export interface SecurityPlanFilterFootprint {
  readonly scope: SecurityPlanScope & { readonly statement: string };
  readonly isHonestView: boolean;
  readonly excludedByModule: readonly SecurityPlanModuleExclusion[];
  readonly totalExcluded: number;
  readonly computedAt: string;
}

export const SECURITY_PLAN_PROSE_SECTIONS = ["scope", "methodology", "exclusions", "executiveSummary"] as const;
export type SecurityPlanProseSection = (typeof SECURITY_PLAN_PROSE_SECTIONS)[number];

export interface SecurityPlanProseSectionContent {
  readonly text: string;
  readonly editedInThisVersion: boolean;
}

export type SecurityPlanProse = Record<SecurityPlanProseSection, SecurityPlanProseSectionContent>;

/** The full assembled document — what `content` on a version actually holds. */
export interface SecurityPlanContent {
  readonly customerId: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly assembledAt: string;
  readonly modules: readonly SecurityPlanAssembledModule[];
  readonly footprint: SecurityPlanFilterFootprint;
  readonly prose: SecurityPlanProse | null;
}

/** `ClientApprover` (`lib/db/src/schema/msp.ts`) — the same signature shape RBD
 * and Risk Register acceptances already use. */
export interface WireClientApprover {
  readonly name: string;
  readonly title: string;
  readonly email: string;
  readonly signedAt: string;
  readonly ipAddress: string | null;
  readonly signatureHash: string;
}

/** `GET /api/portal/security-plan` — the plan of record (last SIGNED version only). */
export interface WireAssembledSecurityPlan {
  readonly versionNumber: number;
  readonly content: SecurityPlanContent;
  readonly scopeStatement: string;
  readonly signedAt: string;
  readonly signedBy: WireClientApprover;
}

export interface WireSecurityPlanPayload {
  readonly assembledPlan: WireAssembledSecurityPlan | null;
}

/** `GET /api/portal/security-plan/versions` row shape. */
export interface WireSecurityPlanVersionSummary {
  readonly versionUid: string;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedAt: string | null;
  readonly isCurrent: boolean;
}

/** `GET /api/portal/security-plan/versions/current` — the current version,
 * signed or not; what a customer reviews before deciding to sign. */
export interface WireSecurityPlanVersionDetail extends WireSecurityPlanVersionSummary {
  readonly content: SecurityPlanContent;
  readonly scopeStatement: string;
}

export interface SignSecurityPlanVersionRequest {
  readonly fullName: string;
  readonly title?: string;
}

/** One item that changed between the last signed snapshot and the live view. */
export interface SecurityPlanDriftChangedItem {
  readonly id: string;
  readonly title: string;
  readonly from: { readonly state: string | null; readonly detail: string | null };
  readonly to: { readonly state: string | null; readonly detail: string | null };
}

export interface SecurityPlanModuleDrift {
  readonly moduleKey: string;
  readonly label: string;
  readonly added: readonly SecurityPlanAssembledItem[];
  readonly removed: readonly SecurityPlanAssembledItem[];
  readonly changed: readonly SecurityPlanDriftChangedItem[];
}

/** `GET /api/portal/security-plan/drift` (added at #3027). */
export interface WireSecurityPlanDrift {
  readonly hasLastSignedVersion: boolean;
  readonly lastSignedVersionUid: string | null;
  readonly lastSignedVersionNumber: number | null;
  readonly lastSignedAt: string | null;
  readonly modules: readonly SecurityPlanModuleDrift[];
  readonly totalAdded: number;
  readonly totalRemoved: number;
  readonly totalChanged: number;
}

export interface ApiErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}
