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
import { LEGACY_ROLE } from "./legacy-ladder";
import {
  CAPABILITY_COLUMN_ROLE_KEYS,
  LEGACY_CAPABILITY_RULES,
  LEGACY_ROLE_ORDER,
  effectiveLegacyRole,
  isLegacyRole,
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
 * There is exactly one root cause, and it was a bug in the code #2457 transcribed
 * that #2457 declined to copy: `denyIfCannotManageTeam` (portal-team.ts:40-56 as of
 * 2868efa79^) tested `isCustomerTier`, an allow-list of three role names, and took
 * the PERMITTED branch for anything it did not recognise — including a principal
 * with no `mspRole` claim at all, which `buildUserPayload` (auth.ts:217) really can
 * sign. It failed open. Filed as #3360; it was not exploitable only because
 * `assertCustomerAccess` in front of it fails closed.
 *
 * The new model denies that principal, because a principal holding no role row
 * is denied by default (the evaluator's rule 3). Reproducing the fail-open
 * behaviour in the seed — by granting a rung to a user who has none — would be
 * writing a privilege escalation into the data to make a number go green.
 *
 * Since #2460 (2868efa79) the LIVE route reads `customer:team.manage` from these
 * rows, so it has denied that principal too; #3360 verified this and pinned it in
 * portal-team.test.ts. What still disagrees is the new model and the transcription
 * of the OLD rule in `LEGACY_CAPABILITY_RULES`, which stays verbatim because it is
 * this harness's oracle. The entries below are that recorded history, not a live
 * defect.
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
    why: "pre-#2460 portal-team.ts permitted an unrecognised role; the new model, live since #2460, denies it",
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
//
// #2460 — pass A is the one half of this harness that reads the OLD model out of
// the database, and #2460 retires two of the three columns it reads. Once
// `2026-09-10-drop-capability-columns-2460.sql` has been run against a database,
// this pass can no longer be performed there: there is no old model left to compare
// the rows against, which is precisely what "the cutover happened" means.
//
// That is reported, not worked around. Selecting the columns unconditionally would
// make the whole script crash with a Postgres error on a perfectly healthy
// post-cutover database, and defaulting the missing ones to `false` would be worse —
// it would compare the new rows against a fabricated old model and print PASS.
//
// Passes B onward are unaffected: they build principal shapes in memory from
// `LEGACY_CAPABILITY_RULES`, so they keep proving the seeded rows match the
// transcription for every shape, forever.
const columnsPresent = (await db.execute(sql`
  SELECT count(*)::int AS n
    FROM information_schema.columns
   WHERE table_name = 'users'
     AND column_name IN ('can_approve_purchases', 'can_manage_team')
`)).rows[0] as { n: number };

const oldModelIntact = columnsPresent.n === 2;

const users = oldModelIntact
  ? (await db.execute(sql`
      SELECT id, role, msp_role, msp_id, tenant_id,
             can_approve_purchases, can_manage_team, can_approve_changes
      FROM users ORDER BY id
    `)).rows as Array<{
      id: number; role: string; msp_role: string | null; msp_id: number | null; tenant_id: number | null;
      can_approve_purchases: boolean; can_manage_team: boolean; can_approve_changes: boolean;
    }>
  : [];

if (!oldModelIntact) {
  console.log(
    `SKIP  pass A — users.can_approve_purchases / can_manage_team have been dropped (#2460), ` +
    `so there is no old model in this database to compare the rows against. ` +
    `The last real run before the drop is recorded on #2460. Passes below still run.`,
  );
} else if (users.length === 0) {
  fail("no users in the database — pass A would vacuously succeed");
}

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
if (oldModelIntact) {
  console.log(`PASS  pass A — ${users.length} real users × ${RBAC_CAPABILITIES.length} capabilities, through the real loader`);
}

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
    if (user.canApprovePurchases && rung === LEGACY_ROLE.mspOperator) {
      held.push(roleId.get(`msp:${CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases}`)!);
    }
  } else {
    if (user.canManageTeam) held.push(roleId.get(`customer:${CAPABILITY_COLUMN_ROLE_KEYS.manageTeam}`)!);
    if (user.canApproveChanges) held.push(roleId.get(`customer:${CAPABILITY_COLUMN_ROLE_KEYS.approveChanges}`)!);
  }
  return held;
}

// The eight rung shapes: the seven legacy role values held normally, plus the
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

// ── 2b. Maintenance — every real user's rows agree with the rule that keeps them (#3408) ──
//
// Passes A and B prove the SEEDED rows reproduce the old model. Neither can see the
// failure #3408 was filed for: a user created or re-roled after the seed, whose rows
// were simply never written. Pass A would even skip it once the #2460 columns drop.
// This pass needs no old model — it reads each user's own source columns, derives the
// expected memberships in TypeScript (`effectiveLegacyRole`, not the SQL function under
// test), and compares them with the rows actually held.

const syncTriggers = (await db.execute(sql`
  SELECT tgname FROM pg_trigger
   WHERE tgrelid = 'users'::regclass AND NOT tgisinternal
     AND tgname IN ('users_rbac_sync_on_insert', 'users_rbac_sync_on_update')
   ORDER BY tgname
`)).rows as Array<{ tgname: string }>;
check(
  "the #3408 users → *_user_roles sync triggers are installed",
  syncTriggers.map((r) => r.tgname),
  ["users_rbac_sync_on_insert", "users_rbac_sync_on_update"],
);

const memberships = (await db.execute(sql`
  SELECT u.id, u.role, u.msp_role, u.can_approve_changes,
         COALESCE((SELECT array_agg(r.key ORDER BY r.key) FROM msp_user_roles ur
                     JOIN msp_roles r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id AND r.msp_id IS NULL), '{}') AS msp_keys,
         COALESCE((SELECT array_agg(r.key ORDER BY r.key) FROM customer_user_roles ur
                     JOIN customer_roles r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id AND r.tenant_id IS NULL), '{}') AS customer_keys
    FROM users u ORDER BY u.id
`)).rows as Array<{
  id: number; role: string; msp_role: string | null; can_approve_changes: boolean;
  msp_keys: string[]; customer_keys: string[];
}>;

// The rungs on which holding cap.purchases.approve matches the old column: the one
// branch it granted on, and the two above it where it is inert.
const PURCHASE_APPROVER_RUNGS: readonly LegacyRole[] = [LEGACY_ROLE.mspOperator, LEGACY_ROLE.mspAdmin, LEGACY_ROLE.platformAdmin];

const failuresBeforeMaintenance = failures;
if (memberships.length === 0) fail("no users in the database — the maintenance pass would vacuously succeed");
for (const row of memberships) {
  const rung = effectiveLegacyRole({ role: row.role, mspRole: row.msp_role });
  const subject = `user ${row.id} (${row.role}/${row.msp_role ?? "—"})`;
  const expectedRungs = rung ? [rung] : [];

  for (const [system, keys] of [["msp", row.msp_keys], ["customer", row.customer_keys]] as const) {
    const heldRungs = keys.filter((key) => isLegacyRole(key));
    if (JSON.stringify(heldRungs) !== JSON.stringify(expectedRungs)) {
      fail(`${subject} — holds ${system} rung(s) [${heldRungs.join(", ")}], expected ${rung ?? "none"} (#3408 drift)`);
    }
  }

  const holdsChangeApprover = row.customer_keys.includes(CAPABILITY_COLUMN_ROLE_KEYS.approveChanges);
  if (holdsChangeApprover !== row.can_approve_changes) {
    fail(`${subject} — can_approve_changes=${row.can_approve_changes} but ${holdsChangeApprover ? "holds" : "lacks"} ${CAPABILITY_COLUMN_ROLE_KEYS.approveChanges} (#3408 drift)`);
  }

  if (row.msp_keys.includes(CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases) && !(rung && PURCHASE_APPROVER_RUNGS.includes(rung))) {
    fail(`${subject} — holds ${CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases} on rung ${rung ?? "none"}, below MSPOperator (#3408)`);
  }
}
if (failures === failuresBeforeMaintenance) {
  console.log(`PASS  maintenance pass — ${memberships.length} real users hold exactly the rows their users columns imply, in both systems`);
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
