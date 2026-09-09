/**
 * RBAC mechanism (#2455, part of #1696) — one entry point for both identity systems.
 *
 * The tables are in ../schema/rbac.ts; everything here is the mechanism that reads
 * them. Nothing in the running product imports this yet: #2455 lands the
 * foundation alongside `MSP_ROLES` with zero behavior change, #2457 expresses
 * today's roles as data, #2458 moves enforcement onto it.
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
