/**
 * Git #2923 — per-object evidence capture in the mapping engine's count family.
 *
 * Before this change, all ten count-family transforms in `applyMapping` had the
 * real matching Graph/PowerShell/CSV objects in hand at the exact expression
 * that collapsed them to an integer (`result[targetField] = <count>`), and threw
 * them away. `governance:ownerless-groups` stored `ownerlessGroupCount: 37` and
 * nothing that could answer "which 37 groups".
 *
 * These tests pin the capture by BEHAVIOUR, against mapping rules and item
 * shapes taken from the real local database rather than invented ones. Confirmed
 * 2026-09-04 against `shanemccawmsp` (204 `monitor_checks`, 0 endpoints using
 * Graph's raw `$count` suffix), the live transform census that drives which
 * cases are covered here:
 *
 *     count 116 | first 57 | countTruthy 20 | exists 15 | none 10 | countFalse 9
 *     countWhere 28 (across 15 distinct predicates) | countEquals 13
 *     groupByCount 6 | countEmptyArray 5 | raw 5
 *     countIfLastSignInOlderThan(90) 3 | countDuplicates 2
 *
 * and the real sourceFields those rules use — `id` (51), `Name` (43), `value`
 * (21), `skuPartNumber` (6), `owners`, `assignedLicenses`, `signInActivity`,
 * `User Principal Name`, `Owner Principal Name` — which is why the fixtures
 * below carry both Graph camelCase keys and the spaced CSV usage-report headers.
 *
 * TWO INVARIANTS run through every case, and they are the point of the file:
 *   1. THE COUNT IS UNCHANGED. Evidence is additive; a transform that started
 *      reporting a different number would be a regression dressed as a feature.
 *   2. THE EVIDENCE AGREES WITH THE COUNT. `matchedCount` always equals the
 *      published count, and `items.length` equals it too until the cap bites —
 *      at which point `truncated`/`note` say so rather than letting a prefix
 *      read as the whole set.
 */

import { describe, it, expect, vi } from "vitest";

// applyMapping is pure, but monitor-executor.ts imports @workspace/db at module
// scope, which throws without a DATABASE_URL.
vi.mock("@workspace/db", () => ({
  db: {},
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantCheckItemDetailsTable: {},
  tenantsTable: {},
}));

import { applyMapping, EVIDENCE_PROPERTY_KEY } from "./monitor-executor";
import type { MappingRule, EvidenceRecord } from "./monitor-executor";

/** The evidence record for one targetField, or undefined when none was written. */
function evidenceFor(result: Record<string, unknown>, targetField: string): EvidenceRecord | undefined {
  const bag = result[EVIDENCE_PROPERTY_KEY] as Record<string, EvidenceRecord> | undefined;
  return bag?.[targetField];
}

// ── Real fixture shapes ───────────────────────────────────────────────────────

/** /groups?$expand=owners($select=id) — the real ownerless-groups payload. */
const GROUPS_WITH_OWNERS = [
  { id: "g1", displayName: "Finance", visibility: "Private", owners: [{ id: "u1" }] },
  { id: "g2", displayName: "All Company", visibility: "Public", owners: [] },
  { id: "g3", displayName: "Project Falcon", visibility: "Public", owners: [] },
  { id: "g4", displayName: "IT Admins", visibility: "Private", owners: [{ id: "u2" }, { id: "u9" }] },
];

/** /users?$select=...,assignedLicenses,signInActivity — the real stale-user payload. */
const USERS = [
  {
    id: "u1",
    displayName: "Ada Lovelace",
    userPrincipalName: "ada@contoso.com",
    mail: "ada@contoso.com",
    accountEnabled: true,
    assignedLicenses: [{ skuId: "sku-e3" }],
    signInActivity: { lastSignInDateTime: "2020-01-01T00:00:00Z" },
  },
  {
    id: "u2",
    displayName: "Grace Hopper",
    userPrincipalName: "grace@contoso.com",
    mail: "grace@contoso.com",
    accountEnabled: false,
    assignedLicenses: [{ skuId: "sku-e3" }],
    signInActivity: { lastSignInDateTime: new Date().toISOString() },
  },
  {
    id: "u3",
    displayName: "Alan Turing",
    userPrincipalName: "alan@contoso.com",
    mail: "alan@contoso.com",
    accountEnabled: false,
    assignedLicenses: [{ skuId: "sku-e5" }],
    // No signInActivity.lastSignInDateTime at all — the real "never signed in"
    // shape, which the transform counts as stale.
    signInActivity: {},
  },
  {
    id: "u4",
    displayName: "Unlicensed Contractor",
    userPrincipalName: "temp@contoso.com",
    mail: "temp@contoso.com",
    accountEnabled: true,
    assignedLicenses: [],
    signInActivity: { lastSignInDateTime: "2019-06-01T00:00:00Z" },
  },
];

// ── 1. count ──────────────────────────────────────────────────────────────────

describe("#2923 count", () => {
  const mapping: MappingRule[] = [{ sourceField: "id", targetField: "groupCount", transform: "count" }];

  it("keeps the count and captures the real objects behind it", () => {
    const result = applyMapping(GROUPS_WITH_OWNERS, mapping, []);
    expect(result.groupCount).toBe(4);

    const ev = evidenceFor(result, "groupCount")!;
    expect(ev.matchedCount).toBe(4);
    expect(ev.shown).toBe(4);
    expect(ev.truncated).toBe(false);
    expect(ev.note).toBeUndefined();
    expect(ev.transform).toBe("count");
    expect(ev.sourceField).toBe("id");
    expect(ev.items.map((i) => i.id)).toEqual(["g1", "g2", "g3", "g4"]);
    expect(ev.items.map((i) => i.label)).toEqual(["Finance", "All Company", "Project Falcon", "IT Admins"]);
    // The label is attributed to the REAL field it was read from, so nothing
    // downstream can mistake it for text this platform authored.
    expect(ev.items[0].labelField).toBe("displayName");
  });

  it("writes no evidence key at all when nothing matched", () => {
    const result = applyMapping(
      [{ displayName: "no id here" }],
      [{ sourceField: "id", targetField: "groupCount", transform: "count" }],
      [],
    );
    expect(result.groupCount).toBe(0);
    expect(result[EVIDENCE_PROPERTY_KEY]).toBeUndefined();
  });

  it("leaves a zero-match check's extractedProperties byte-identical to the pre-#2923 shape", () => {
    const result = applyMapping([], [{ sourceField: "id", targetField: "n", transform: "count" }], []);
    expect(Object.keys(result).sort()).toEqual(["_itemCount", "n"]);
  });
});

// ── 2. countTruthy ────────────────────────────────────────────────────────────

describe("#2923 countTruthy", () => {
  it("captures only the truthy-valued items", () => {
    const mapping: MappingRule[] = [
      { sourceField: "accountEnabled", targetField: "enabledUserCount", transform: "countTruthy" },
    ];
    const result = applyMapping(USERS, mapping, []);
    expect(result.enabledUserCount).toBe(2);

    const ev = evidenceFor(result, "enabledUserCount")!;
    expect(ev.matchedCount).toBe(2);
    expect(ev.items.map((i) => i.id)).toEqual(["u1", "u4"]);
    // The rule's own field is projected alongside the identity, since it is the
    // one field that explains why the row is in the list.
    expect(ev.items[0].fields.accountEnabled).toBe(true);
  });
});

// ── 3. countFalse ─────────────────────────────────────────────────────────────

describe("#2923 countFalse", () => {
  it("captures the literally-false items and no other falsy ones", () => {
    const mapping: MappingRule[] = [
      { sourceField: "accountEnabled", targetField: "disabledUserCount", transform: "countFalse" },
    ];
    const result = applyMapping(USERS, mapping, []);
    expect(result.disabledUserCount).toBe(2);

    const ev = evidenceFor(result, "disabledUserCount")!;
    expect(ev.items.map((i) => i.id)).toEqual(["u2", "u3"]);
    expect(ev.items.every((i) => i.fields.accountEnabled === false)).toBe(true);
  });
});

// ── 4. countEquals ────────────────────────────────────────────────────────────

describe("#2923 countEquals", () => {
  // The real stored rule: countEquals('Public') over /groups, ×3 in the DB.
  const mapping: MappingRule[] = [
    { sourceField: "visibility", targetField: "publicGroupCount", transform: "countEquals('Public')" },
  ];

  it("captures the matching objects and carries the transform's arguments verbatim", () => {
    const result = applyMapping(GROUPS_WITH_OWNERS, mapping, []);
    expect(result.publicGroupCount).toBe(2);

    const ev = evidenceFor(result, "publicGroupCount")!;
    expect(ev.transform).toBe("countEquals('Public')");
    expect(ev.matchedCount).toBe(2);
    expect(ev.items.map((i) => i.label)).toEqual(["All Company", "Project Falcon"]);
    expect(ev.items.every((i) => i.fields.visibility === "Public")).toBe(true);
  });
});

// ── 5. countEmptyArray ────────────────────────────────────────────────────────

describe("#2923 countEmptyArray", () => {
  const mapping: MappingRule[] = [
    { sourceField: "owners", targetField: "ownerlessGroupCount", transform: "countEmptyArray" },
  ];

  it("answers the question the issue was filed about — WHICH groups are ownerless", () => {
    const result = applyMapping(GROUPS_WITH_OWNERS, mapping, []);
    expect(result.ownerlessGroupCount).toBe(2);

    const ev = evidenceFor(result, "ownerlessGroupCount")!;
    expect(ev.items.map((i) => i.id)).toEqual(["g2", "g3"]);
    expect(ev.items.map((i) => i.label)).toEqual(["All Company", "Project Falcon"]);
    // The empty array IS the finding, and it is carried as the real value.
    expect(ev.items[0].fields.owners).toEqual([]);
  });

  it("captures nothing when the $expand is missing, matching the count it still reports", () => {
    // The real misconfiguration this transform already warns about: no `owners`
    // key on any item. The count stays 0 (deliberately under-reporting rather
    // than reporting the whole estate as ownerless), and there is no evidence to
    // contradict it.
    const result = applyMapping([{ id: "g1", displayName: "Finance" }], mapping, []);
    expect(result.ownerlessGroupCount).toBe(0);
    expect(evidenceFor(result, "ownerlessGroupCount")).toBeUndefined();
  });
});

// ── 6. countIfLastSignInOlderThan ─────────────────────────────────────────────

describe("#2923 countIfLastSignInOlderThan", () => {
  // The real stored rule, ×3 in the DB.
  const mapping: MappingRule[] = [
    {
      sourceField: "assignedLicenses",
      targetField: "staleLicensedUserCount",
      transform: "countIfLastSignInOlderThan(90)",
    },
  ];

  it("captures the stale licensed users with their real last-sign-in timestamps", () => {
    const result = applyMapping(USERS, mapping, []);
    // u1 stale (2020), u3 never signed in, u2 recent, u4 unlicensed.
    expect(result.staleLicensedUserCount).toBe(2);

    const ev = evidenceFor(result, "staleLicensedUserCount")!;
    expect(ev.matchedCount).toBe(2);
    expect(ev.items.map((i) => i.id)).toEqual(["u1", "u3"]);
    // The evidence field is the SIGN-IN timestamp, not the licence array — that
    // is what makes the row self-explanatory. `null` is the real "never signed
    // in" case, carried as such rather than omitted.
    expect(ev.items[0].fields["signInActivity.lastSignInDateTime"]).toBe("2020-01-01T00:00:00Z");
    expect(ev.items[1].fields["signInActivity.lastSignInDateTime"]).toBeNull();
  });
});

// ── 7. groupByCount ───────────────────────────────────────────────────────────

describe("#2923 groupByCount", () => {
  const mapping: MappingRule[] = [
    { sourceField: "visibility", targetField: "groupsByVisibility", transform: "groupByCount" },
  ];

  it("keeps the bucket map and captures the members behind every bucket", () => {
    const result = applyMapping(GROUPS_WITH_OWNERS, mapping, []);
    expect(result.groupsByVisibility).toEqual({ Private: 2, Public: 2 });

    const ev = evidenceFor(result, "groupsByVisibility")!;
    // One evidence entry per counted OCCURRENCE, so the totals and the evidence
    // can only ever agree.
    expect(ev.matchedCount).toBe(4);
    const byBucket = (bucket: string) =>
      ev.items.filter((i) => i.fields.visibility === bucket).map((i) => i.label);
    expect(byBucket("Public")).toEqual(["All Company", "Project Falcon"]);
    expect(byBucket("Private")).toEqual(["Finance", "IT Admins"]);
  });
});

// ── 8. countDuplicates ────────────────────────────────────────────────────────

describe("#2923 countDuplicates", () => {
  const mapping: MappingRule[] = [
    { sourceField: "mail", targetField: "duplicateMailCount", transform: "countDuplicates" },
  ];

  it("names the objects holding each duplicated value, which the bare count cannot", () => {
    const items = [
      { id: "u1", displayName: "Ada", mail: "shared@contoso.com" },
      { id: "u2", displayName: "Grace", mail: "shared@contoso.com" },
      { id: "u3", displayName: "Alan", mail: "unique@contoso.com" },
    ];
    const result = applyMapping(items, mapping, []);
    expect(result.duplicateMailCount).toBe(2);

    const ev = evidenceFor(result, "duplicateMailCount")!;
    expect(ev.matchedCount).toBe(2);
    // The matched thing is the flattened VALUE; the owner is the object holding
    // it. Without the owner, "shared@contoso.com is duplicated" names nobody.
    expect(ev.items.map((i) => i.label)).toEqual(["shared@contoso.com", "shared@contoso.com"]);
    expect(ev.items.map((i) => i.owner?.id)).toEqual(["u1", "u2"]);
    expect(ev.items.map((i) => i.owner?.label)).toEqual(["Ada", "Grace"]);
  });

  it("preserves countDuplicateValues' occurrence semantics — three copies contribute three", () => {
    const items = [
      { id: "a", mail: "x@contoso.com" },
      { id: "b", mail: "x@contoso.com" },
      { id: "c", mail: "x@contoso.com" },
    ];
    const result = applyMapping(items, mapping, []);
    expect(result.duplicateMailCount).toBe(3);
    expect(evidenceFor(result, "duplicateMailCount")!.matchedCount).toBe(3);
  });
});

// ── 9. countWhere ─────────────────────────────────────────────────────────────

describe("#2923 countWhere", () => {
  it("captures the matching ITEMS when the predicate runs over items", () => {
    // A real stored predicate, verbatim from the DB.
    const mapping: MappingRule[] = [
      {
        sourceField: "value",
        targetField: "disabledUserCount",
        transform: "countWhere('{{accountEnabled}} == false && {{manager.id}} == null')",
      },
    ];
    const result = applyMapping(USERS, mapping, []);
    expect(result.disabledUserCount).toBe(2);

    const ev = evidenceFor(result, "disabledUserCount")!;
    expect(ev.items.map((i) => i.id)).toEqual(["u2", "u3"]);
    // The whole predicate is what matched, so no single field is claimed as the
    // reason — the record carries the predicate itself instead.
    expect(ev.transform).toContain("accountEnabled");
    expect(ev.items.every((i) => i.owner === undefined)).toBe(true);
  });

  it("captures the matching ENTRIES with their owning item when the predicate runs over an array", () => {
    // The real cert/secret-expiration shape: countWhere over each app's
    // passwordCredentials array.
    const apps = [
      {
        id: "app1",
        displayName: "Legacy Sync",
        passwordCredentials: [
          { keyId: "k1", endDateTime: "2020-01-01T00:00:00Z" },
          { keyId: "k2", endDateTime: "2099-01-01T00:00:00Z" },
        ],
      },
      {
        id: "app2",
        displayName: "Reporting Job",
        passwordCredentials: [{ keyId: "k3", endDateTime: "2021-05-05T00:00:00Z" }],
      },
    ];
    const mapping: MappingRule[] = [
      {
        sourceField: "passwordCredentials",
        targetField: "expiredSecretCount",
        transform: "countWhere('{{endDateTime}} olderThanDays 0')",
      },
    ];
    const result = applyMapping(apps, mapping, []);
    expect(result.expiredSecretCount).toBe(2);

    const ev = evidenceFor(result, "expiredSecretCount")!;
    expect(ev.matchedCount).toBe(2);
    // An expired secret with no owning app is not actionable — the owner link
    // that `arrays.flat()` used to destroy is what makes it so.
    expect(ev.items.map((i) => i.owner?.id)).toEqual(["app1", "app2"]);
    expect(ev.items.map((i) => i.owner?.label)).toEqual(["Legacy Sync", "Reporting Job"]);
    // The entry carries no identity allow-list field, so its own real scalar
    // fields are projected in document order rather than an empty object.
    expect(ev.items[0].fields).toEqual({ keyId: "k1", endDateTime: "2020-01-01T00:00:00Z" });
  });

  it("captures CSV usage-report rows under their real spaced headers", () => {
    // Real stored predicate + real report headers (both confirmed in the DB).
    const rows = [
      { "User Principal Name": "ada@contoso.com", "Display Name": "Ada", "Is Deleted": "False", "Last Activity Date": "" },
      { "User Principal Name": "grace@contoso.com", "Display Name": "Grace", "Is Deleted": "False", "Last Activity Date": "2026-09-03" },
    ];
    const mapping: MappingRule[] = [
      {
        sourceField: "value",
        targetField: "neverActiveCount",
        transform: "countWhere('{{Last Activity Date}} == \"\" && {{Is Deleted}} == \"False\"')",
      },
    ];
    const result = applyMapping(rows, mapping, []);
    expect(result.neverActiveCount).toBe(1);

    const ev = evidenceFor(result, "neverActiveCount")!;
    expect(ev.items[0].label).toBe("Ada");
    expect(ev.items[0].labelField).toBe("Display Name");
    expect(ev.items[0].fields["User Principal Name"]).toBe("ada@contoso.com");
  });
});

// ── 10. countDuplicatesBy ─────────────────────────────────────────────────────

describe("#2923 countDuplicatesBy", () => {
  const mapping: MappingRule[] = [
    {
      sourceField: "assignedLicenses",
      targetField: "duplicateSkuCount",
      transform: "countDuplicatesBy('skuId')",
    },
  ];

  it("names which users hold each duplicated SKU", () => {
    const result = applyMapping(USERS, mapping, []);
    // sku-e3 held by u1 and u2; sku-e5 held once; u4 holds none.
    expect(result.duplicateSkuCount).toBe(2);

    const ev = evidenceFor(result, "duplicateSkuCount")!;
    expect(ev.matchedCount).toBe(2);
    expect(ev.items.map((i) => i.fields.skuId)).toEqual(["sku-e3", "sku-e3"]);
    expect(ev.items.map((i) => i.owner?.label)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });
});

// ── The cap, and the honesty of it ────────────────────────────────────────────

describe("#2923 evidence cap", () => {
  it("reports the REAL total and says out loud that the list is a prefix", () => {
    // The real blast-radius case named in the issue: thousands of matching
    // users. extractedProperties is written as jsonb per tenant per run, so an
    // unbounded array would multiply every scan's row size by tenant size.
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `u${i}`,
      displayName: `User ${i}`,
      accountEnabled: false,
    }));
    const result = applyMapping(
      many,
      [{ sourceField: "accountEnabled", targetField: "disabledUserCount", transform: "countFalse" }],
      [],
    );

    // The COUNT is the real one — the cap bounds the evidence, never the answer.
    expect(result.disabledUserCount).toBe(1200);

    const ev = evidenceFor(result, "disabledUserCount")!;
    expect(ev.matchedCount).toBe(1200);
    expect(ev.shown).toBe(50);
    expect(ev.items).toHaveLength(50);
    expect(ev.truncated).toBe(true);
    expect(ev.note).toBe("Showing the first 50 of 1200 matching objects.");
    // A prefix, in document order — not a sample, and not the tail.
    expect(ev.items[0].id).toBe("u0");
    expect(ev.items[49].id).toBe("u49");
  });

  it("bounds the WIDTH of each evidence item as well as the length of the list", () => {
    const wide = [
      {
        id: "u1",
        displayName: "Ada",
        userPrincipalName: "ada@contoso.com",
        mail: "ada@contoso.com",
        webUrl: "https://contoso.example/u1",
        uniqueName: "ada",
        title: "Engineer",
        accountEnabled: false,
        // Nested and long values are not carried: the identity fields already
        // say which object this is, and this is the unbounded payload the cap
        // exists to keep out of the row.
        manager: { id: "u9", displayName: "Grace" },
        proxyAddresses: Array.from({ length: 40 }, (_, i) => `smtp:a${i}@contoso.com`),
      },
    ];
    const result = applyMapping(
      wide,
      [{ sourceField: "accountEnabled", targetField: "n", transform: "countFalse" }],
      [],
    );
    const ev = evidenceFor(result, "n")!;
    const fields = ev.items[0].fields;
    // 6 identity fields, plus the rule's own field, which is never the one
    // dropped by the cap.
    expect(Object.keys(fields)).toHaveLength(7);
    expect(fields.accountEnabled).toBe(false);
    expect(fields.manager).toBeUndefined();
    expect(fields.proxyAddresses).toBeUndefined();
  });

  it("carries a short scalar array verbatim, because that is often the whole finding", () => {
    const items = [{ id: "g1", displayName: "Finance", groupTypes: ["Unified"], visibility: "Public" }];
    const result = applyMapping(
      items,
      [{ sourceField: "groupTypes", targetField: "n", transform: "count" }],
      [],
    );
    expect(evidenceFor(result, "n")!.items[0].fields.groupTypes).toEqual(["Unified"]);
  });
});

// ── Additive-only: nothing that existed before behaves differently ────────────

describe("#2923 additive-only guarantees", () => {
  it("does not change any non-count transform's output, and writes no evidence for them", () => {
    const mapping: MappingRule[] = [
      { sourceField: "displayName", targetField: "firstName", transform: "first" },
      { sourceField: "displayName", targetField: "names", transform: "join" },
      { sourceField: "id", targetField: "anyGroups", transform: "exists" },
      { sourceField: "value", targetField: "rawGroups", transform: "raw" },
      { sourceField: "assignedLicenses", targetField: "skus", transform: "flattenValues('skuId')" },
    ];
    const result = applyMapping(USERS, mapping, []);
    expect(result.firstName).toBe("Ada Lovelace");
    expect(result.anyGroups).toBe(true);
    expect(result.rawGroups).toHaveLength(4);
    expect(result.skus).toEqual(["sku-e3", "sku-e3", "sku-e5"]);
    // Evidence is a COUNT-family concept: `first`/`join`/`exists`/`raw`/
    // `flattenValues` already carry their own real values.
    expect(result[EVIDENCE_PROPERTY_KEY]).toBeUndefined();
  });

  it("keys evidence by targetField, so a check with several count rules keeps them apart", () => {
    const mapping: MappingRule[] = [
      { sourceField: "owners", targetField: "ownerlessGroupCount", transform: "countEmptyArray" },
      { sourceField: "visibility", targetField: "publicGroupCount", transform: "countEquals('Public')" },
    ];
    const result = applyMapping(GROUPS_WITH_OWNERS, mapping, []);
    const bag = result[EVIDENCE_PROPERTY_KEY] as Record<string, EvidenceRecord>;
    expect(Object.keys(bag).sort()).toEqual(["ownerlessGroupCount", "publicGroupCount"]);
    expect(bag.ownerlessGroupCount.sourceField).toBe("owners");
    expect(bag.publicGroupCount.sourceField).toBe("visibility");
  });

  it("uses a reserved underscore-prefixed key, which the existing internal-key filters already skip", () => {
    // monitor-check-trace.ts filters `_`-prefixed keys out of its produced-key
    // list, and dashboard-resolvers.ts's aggregateGroupBy skips them too. The
    // key name is what makes both of those true without either being edited.
    expect(EVIDENCE_PROPERTY_KEY.startsWith("_")).toBe(true);
    const result = applyMapping(GROUPS_WITH_OWNERS, [
      { sourceField: "id", targetField: "groupCount", transform: "count" },
    ], []);
    const nonInternal = Object.keys(result).filter((k) => !k.startsWith("_"));
    expect(nonInternal).toEqual(["groupCount"]);
  });
});
