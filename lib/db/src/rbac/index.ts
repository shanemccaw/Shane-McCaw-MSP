/**
 * RBAC mechanism (#2455, part of #1696) — one entry point for both identity systems.
 *
 * The tables are in ../schema/rbac.ts; everything here is the mechanism that reads
 * them. Nothing in the running product imports this yet: #2455 landed the
 * foundation alongside `MSP_ROLES` with zero behavior change, #2457 expressed
 * today's seven roles and three capability columns as real rows (and added
 * ./legacy-ladder.ts, the citable transcription of what those rules are today),
 * #2458 moves enforcement onto it.
 */

export {
  RBAC_SYSTEMS,
  RBAC_CAPABILITIES,
  capabilityId,
  findCapability,
  isKnownCapability,
  listCapabilities,
  type RbacCapability,
  type RbacSystem,
} from "./capabilities";

export {
  CAPABILITY_COLUMN_ROLE_KEYS,
  LADDER_CAPABILITY_CATEGORY,
  LADDER_CAPABILITY_KEYS,
  LADDER_CAPABILITY_PREFIX,
  LEGACY_CAPABILITY_RULES,
  LEGACY_ROLE_ORDER,
  effectiveLegacyRole,
  isLegacyRole,
  ladderCapabilityDescription,
  ladderCapabilityKey,
  ladderCapabilityLabel,
  ladderCapabilityRole,
  legacyDecision,
  legacyRequireRole,
  legacyRoleIndex,
  type LegacyCapabilityRule,
  type LegacyRole,
  type LegacyUserRow,
} from "./legacy-ladder";

export {
  createRbacEvaluator,
  evaluateCapability,
  type RbacContext,
  type RbacDecision,
  type RbacEffect,
  type RbacEvaluationInput,
  type RbacEvaluator,
  type RbacFeatureMapping,
} from "./evaluate";

export {
  listRoleMembers,
  loadRbacContext,
  loadRbacEvaluator,
  type LoadRbacContextInput,
  type RbacDb,
} from "./load";

export { syncCapabilityCatalog, type CapabilitySyncResult } from "./sync";
