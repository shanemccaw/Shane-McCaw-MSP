/**
 * OLD vs NEW parity harness (#2457, part of #1696) — this step's acceptance test.
 *
 * #2457's own "Done when": *"Every current role/user still resolves to the exact
 * same effective permission set under the new evaluator as under the old ladder
 * (a comparison script proving old-vs-new agreement for every real user is the
 * acceptance test)."* This is that script.
 *
 * Run:
 *   pnpm --filter @workspace/db run check-rbac-parity
 *
 * READ-ONLY. It writes nothing, opens no transaction, and needs `DATABASE_URL`
 * pointed at a database the two RBAC migrations have been applied to (local dev —
 * never staging or production). Exit code 0 means every comparison agreed.
 *
 * ── The two sides ───────────────────────────────────────────────────────────
 * OLD  `legacyDecision()` from ./legacy-ladder.ts — today's rules transcribed
 *      from the live route code, each cited to file:line, evaluated against the
 *      user's REAL `users` row (including all three capability columns).
 * NEW  #2455's evaluator, run over the REAL rows #2457's seed migration wrote.
 *      Pass A goes through `loadRbacEvaluator`, so the loader's scope filtering
 *      is part of what is being proven, not bypassed.
 *
 * Neither side is derived from the other. If the seed is wrong, the two disagree.
 *
 * ── Why there are two passes ────────────────────────────────────────────────
 * Only three of the seven rungs are occupied by a real user in this database
 * (PlatformAdmin, CustomerUser, Assessment), and only one of the three capability
 * columns is set on anybody. Pass A alone would therefore leave most of the
 * seeded data unproven while reporting "all real users agree" — a green result
 * that means much less than it looks like.
 *
 * Pass B closes that: it takes every possible principal SHAPE — each of the seven
 * rungs, plus the `role = 'admin'` legacy promotion, crossed with all eight
 * combinations of the three capability columns — and runs both sides for each. It
 * uses the real seeded role uuids and the real seeded mapping payloads read out of
 * the database; the only thing it synthesises is which of those real roles a
 * hypothetical principal holds. Nothing is inserted, so no fake user is ever
 * created to be forgotten about.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { RBAC_CAPABILITIES, type RbacSystem } from "./capabilities";
import { evaluateCapability, type RbacFeatureMapping } from "./evaluate";
import { loadRbacEvaluator } from "./load";
import {
  CAPABILITY_COLUMN_ROLE_KEYS,
  LEGACY_CAPABILITY_RULES,
  LEGACY_ROLE_ORDER,
  effectiveLegacyRole,
  legacyDecision,
  type LegacyRole,
  type LegacyUserRow,
} from "./legacy-ladder";

let failures = 0;
let comparisons = 0;

function fail(message: string): void {
  failures++;
  console.log(`FAIL  ${message}`);
}

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`PASS  ${label}`);
  } else {
    fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

/**
 * Places where the new model deliberately does NOT reproduce the old one.
 *
 * There is exactly one root cause, and it is a bug in today's code that #2457
 * declined to copy: `denyIfCannotManageTeam` (portal-team.ts:40-54) tests
 * `isCustomerTier`, an allow-list of three role names, and takes the PERMITTED
 * branch for anything it does not recognise — including a principal with no
 * `mspRole` claim at all, which `buildUserPayload` (auth.ts:217) really can sign.
 * It fails open. Filed as #3360 with the full evidence; it is not exploitable
 * today only because `assertCustomerAccess` in front of it fails closed.
 *
 * The new model denies that principal, because a principal holding no role row
 * is denied by default (the evaluator's rule 3). Reproducing the fail-open
 * behaviour in the seed — by granting a rung to a user who has none — would be
 * writing a privilege escalation into the data to make a number go green.
 *
 * So these two are allowed to disagree, under three conditions the run enforces:
 * each must be named here, each must diverge in the fail-CLOSED direction only
 * (old ALLOW, new DENY — never the reverse), and each must actually be observed,
 * so an entry that stops being true gets noticed instead of quietly excusing
 * something else later.
 */
interface KnownDivergence {
  readonly shape: string;
  readonly system: RbacSystem;
  readonly capability: string;
  readonly issue: string;
  readonly why: string;
}

const KNOWN_FAIL_CLOSED_DIVERGENCES: readonly KnownDivergence[] = [
  {
    shape: "unrecognised msp_role",
    system: "customer",
    capability: "team.manage",
    issue: "#3360",
    why: "portal-team.ts:40-54 permits an unrecognised role; the new model denies it",
  },
  {
    shape: "unrecognised msp_role",
    system: "customer",
    capability: "billing.view",
    issue: "#3360",
    why: "portal-billing.ts is requireAuth-only, so 'everyone' includes a principal holding no rung",
  },
];

const divergenceKey = (shape: string, system: RbacSystem, capability: string) => `${shape}|${system}:${capability}`;
const KNOWN_BY_KEY = new Map(KNOWN_FAIL_CLOSED_DIVERGENCES.map((d) => [divergenceKey(d.shape, d.system, d.capability), d]));
const observedDivergences = new Set<string>();

/**
 * One old-vs-new comparison. Silent on agreement — there are hundreds of these.
 *
 * `shape` is the stable identity of the principal being compared (a real user id,
 * or a synthesised shape name); `subject` is the readable form for the log.
 */
function compare(
  shape: string,
  subject: string,
  system: RbacSystem,
  capability: string,
  old_: boolean,
  new_: boolean,
): void {
  comparisons++;
  if (old_ === new_) return;

  const known = KNOWN_BY_KEY.get(divergenceKey(shape, system, capability));
  if (known && old_ && !new_) {
    observedDivergences.add(divergenceKey(shape, system, capability));
    console.log(`KNOWN ${subject} — ${system}:${capability}: OLD ALLOW, NEW DENY (${known.issue} — ${known.why})`);
    return;
  }
  if (known) {
    // Registered, but the wrong way round: the new model has GAINED a permission
    // the old one refuses. That is never an acceptable outcome of a migration
    // whose entire contract is that nothing observable changes.
    fail(
      `${subject} — ${system}:${capability}: registered divergence ${known.issue} has FLIPPED ` +
        `DIRECTION — OLD says DENY, NEW says ALLOW. That is a privilege gain, not a fail-closed difference.`,
    );
    return;
  }
  fail(
    `${subject} — ${system}:${capability}: OLD says ${old_ ? "ALLOW" : "DENY"}, ` +
      `NEW says ${new_ ? "ALLOW" : "DENY"}`,
  );
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ── 0. Structural preconditions ──────────────────────────────────────────────
// A parity run over a capability with no transcribed rule, or over a catalog the
// seed never reached, would agree with itself and prove nothing. Check the shape
// before comparing anything.

const catalogIds = RBAC_CAPABILITIES.map((c) => `${c.system}:${c.key}`).sort();
const ruleIds = LEGACY_CAPABILITY_RULES.map((r) => `${r.system}:${r.key}`).sort();
check("every catalogued capability has a transcribed old rule, and vice versa", ruleIds, catalogIds);

const tableRows = (await db.execute(sql`
  SELECT system, key FROM rbac_capabilities WHERE is_active ORDER BY system, key
`)).rows as Array<{ system: string; key: string }>;
check(
  "the rbac_capabilities table matches the TS catalog",
  tableRows.map((r) => `${r.system}:${r.key}`).sort(),
  catalogIds,
);

const platformMappings = (await db.execute(sql`
  SELECT 'msp' AS system, capability_key FROM msp_feature_role_mapping WHERE msp_id IS NULL
  UNION ALL
  SELECT 'customer', capability_key FROM customer_feature_role_mapping WHERE tenant_id IS NULL
`)).rows as Array<{ system: string; capability_key: string }>;
check(
  "every catalogued capability has a platform-scoped mapping row",
  platformMappings.map((r) => `${r.system}:${r.capability_key}`).sort(),
  catalogIds,
);

// Every rung, in both systems, plus the three capability-column roles.
const roleRows = (await db.execute(sql`
  SELECT 'msp' AS system, key, id::text AS id FROM msp_roles WHERE msp_id IS NULL
  UNION ALL
  SELECT 'customer', key, id::text FROM customer_roles WHERE tenant_id IS NULL
`)).rows as Array<{ system: RbacSystem; key: string; id: string }>;
const roleId = new Map(roleRows.map((r) => [`${r.system}:${r.key}`, r.id]));

const expectedRoleKeys = [
  ...LEGACY_ROLE_ORDER.map((r) => `msp:${r}`),
  ...LEGACY_ROLE_ORDER.map((r) => `customer:${r}`),
  `msp:${CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases}`,
  `customer:${CAPABILITY_COLUMN_ROLE_KEYS.manageTeam}`,
  `customer:${CAPABILITY_COLUMN_ROLE_KEYS.approveChanges}`,
].sort();
check("the seeded platform roles are exactly the seven rungs plus one role per column", [...roleId.keys()].sort(), expectedRoleKeys);

// ── 1. Pass A — every real user, through the real loader ─────────────────────

const users = (await db.execute(sql`
  SELECT id, role, msp_role, msp_id, tenant_id,
         can_approve_purchases, can_manage_team, can_approve_changes
  FROM users ORDER BY id
`)).rows as Array<{
  id: number; role: string; msp_role: string | null; msp_id: number | null; tenant_id: number | null;
  can_approve_purchases: boolean; can_manage_team: boolean; can_approve_changes: boolean;
}>;

if (users.length === 0) fail("no users in the database — pass A would vacuously succeed");

for (const row of users) {
  const user: LegacyUserRow = {
    id: row.id,
    role: row.role,
    mspRole: row.msp_role,
    mspId: row.msp_id,
    tenantId: row.tenant_id,
    canApprovePurchases: row.can_approve_purchases,
    canManageTeam: row.can_manage_team,
    canApproveChanges: row.can_approve_changes,
  };
  const subject = `user ${row.id} (${row.role}/${row.msp_role ?? "—"})`;

  // The org each system evaluates inside: msps.id for MSP identity, tenants.id
  // for customer identity. Null is legitimate — user 1 holds no tenant.
  const mspEval = await loadRbacEvaluator(db as never, { system: "msp", userId: row.id, orgId: row.msp_id });
  const customerEval = await loadRbacEvaluator(db as never, { system: "customer", userId: row.id, orgId: row.tenant_id });

  for (const capability of RBAC_CAPABILITIES) {
    const evaluator = capability.system === "msp" ? mspEval : customerEval;
    compare(
      `user ${row.id}`,
      subject,
      capability.system,
      capability.key,
      legacyDecision(user, capability.system, capability.key),
      evaluator.can(capability.key),
    );
  }

  // The rung a user holds is the ONE thing the seed derives per user, so check it
  // directly too — a parity pass could otherwise be satisfied by two errors that
  // happen to cancel.
  const expectedRung = effectiveLegacyRole(user);
  const heldRungs = mspEval.context.roleIds.filter((id) => {
    const key = roleRows.find((r) => r.system === "msp" && r.id === id)?.key;
    return key !== undefined && (LEGACY_ROLE_ORDER as readonly string[]).includes(key);
  });
  const expectedIds = expectedRung ? [roleId.get(`msp:${expectedRung}`)!] : [];
  if (JSON.stringify(heldRungs.sort()) !== JSON.stringify(expectedIds.sort())) {
    fail(`${subject} — holds ${heldRungs.length} MSP rung(s), expected exactly ${expectedRung ?? "none"}`);
  }
}
console.log(`PASS  pass A — ${users.length} real users × ${RBAC_CAPABILITIES.length} capabilities, through the real loader`);

// ── 2. Pass B — every possible principal shape, against the real seeded rows ──

const mappingRows = (await db.execute(sql`
  SELECT 'msp' AS system, capability_key, msp_id AS org_id, roles FROM msp_feature_role_mapping
  UNION ALL
  SELECT 'customer', capability_key, tenant_id, roles FROM customer_feature_role_mapping
`)).rows as Array<{ system: RbacSystem; capability_key: string; org_id: number | null; roles: { allow: string[]; deny: string[] } }>;

const mappings: RbacFeatureMapping[] = mappingRows.map((r) => ({
  system: r.system,
  capabilityKey: r.capability_key,
  orgId: r.org_id,
  allow: r.roles?.allow ?? [],
  deny: r.roles?.deny ?? [],
}));

/** Which seeded roles a principal of this shape would hold — the seed's own rules. */
function rolesFor(system: RbacSystem, rung: LegacyRole | undefined, user: LegacyUserRow): string[] {
  const held: string[] = [];
  if (rung) held.push(roleId.get(`${system}:${rung}`)!);
  if (system === "msp") {
    if (user.canApprovePurchases && rung === "MSPOperator") {
      held.push(roleId.get(`msp:${CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases}`)!);
    }
  } else {
    if (user.canManageTeam) held.push(roleId.get(`customer:${CAPABILITY_COLUMN_ROLE_KEYS.manageTeam}`)!);
    if (user.canApproveChanges) held.push(roleId.get(`customer:${CAPABILITY_COLUMN_ROLE_KEYS.approveChanges}`)!);
  }
  return held;
}

// The eight rung shapes: the seven MSP_ROLES values held normally, plus the
// legacy `role = 'admin'` promotion, which #1696 insists be carried across
// deliberately. Its msp_role is set to the LOWEST rung on purpose — if the
// promotion were being dropped, this shape is where it would show.
const shapes: Array<{ label: string; role: string; mspRole: string | null }> = [
  ...LEGACY_ROLE_ORDER.map((r) => ({ label: r, role: "client", mspRole: r as string })),
  { label: "legacy role='admin' (msp_role=Assessment)", role: "admin", mspRole: "Assessment" },
];

let shapeCount = 0;
for (const shape of shapes) {
  for (const flags of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const user: LegacyUserRow = {
      id: -1,
      role: shape.role,
      mspRole: shape.mspRole,
      mspId: 1,
      tenantId: 1,
      canApprovePurchases: (flags & 1) !== 0,
      canManageTeam: (flags & 2) !== 0,
      canApproveChanges: (flags & 4) !== 0,
    };
    const rung = effectiveLegacyRole(user);
    const subject =
      `shape ${shape.label} [purchases=${user.canApprovePurchases} team=${user.canManageTeam} changes=${user.canApproveChanges}]`;
    shapeCount++;

    for (const capability of RBAC_CAPABILITIES) {
      const decision = evaluateCapability({
        system: capability.system,
        capability: capability.key,
        roleIds: rolesFor(capability.system, rung, user),
        mappings,
        orgId: capability.system === "msp" ? user.mspId : user.tenantId,
      });
      compare(shape.label, subject, capability.system, capability.key, legacyDecision(user, capability.system, capability.key), decision.allowed);
    }
  }
}
console.log(`PASS  pass B — ${shapeCount} principal shapes × ${RBAC_CAPABILITIES.length} capabilities, against the real seeded rows`);

// A principal whose msp_role is not one of the seven holds no rung and must fail
// every floor, exactly as `roleIndex()` returning -1 does today.
const strayUser: LegacyUserRow = {
  id: -1, role: "client", mspRole: "NotARole", mspId: 1, tenantId: 1,
  canApprovePurchases: false, canManageTeam: false, canApproveChanges: false,
};
for (const capability of RBAC_CAPABILITIES) {
  const decision = evaluateCapability({
    system: capability.system,
    capability: capability.key,
    roleIds: rolesFor(capability.system, effectiveLegacyRole(strayUser), strayUser),
    mappings,
    orgId: 1,
  });
  compare("unrecognised msp_role", "shape unrecognised msp_role", capability.system, capability.key, legacyDecision(strayUser, capability.system, capability.key), decision.allowed);
}

// ── 3. Every registered divergence must still be real ────────────────────────
// An excuse that has stopped applying is worse than no excuse: it stays in the
// list and silently covers whatever lands on the same key next.
for (const known of KNOWN_FAIL_CLOSED_DIVERGENCES) {
  const key = divergenceKey(known.shape, known.system, known.capability);
  if (!observedDivergences.has(key)) {
    fail(
      `registered divergence ${known.issue} (${known.shape} — ${known.system}:${known.capability}) ` +
        `did not occur. If it has been fixed, delete the entry; if the probe stopped covering it, ` +
        `the probe is what is broken.`,
    );
  }
}
if (observedDivergences.size === KNOWN_FAIL_CLOSED_DIVERGENCES.length) {
  console.log(`PASS  all ${observedDivergences.size} registered fail-closed divergences occurred, none flipped direction`);
}

await pool.end();
console.log(
  failures === 0
    ? `\n--- RBAC OLD-vs-NEW PARITY: ${comparisons} comparisons, ALL AGREED ` +
        `(${observedDivergences.size} registered fail-closed divergences) ---`
    : `\n--- RBAC OLD-vs-NEW PARITY: ${failures} FAILURE(S) across ${comparisons} comparisons ---`,
);
process.exit(failures === 0 ? 0 : 1);
