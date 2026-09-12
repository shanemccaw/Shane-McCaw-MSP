/**
 * THE TEST THAT STOPS THE PURGE DECLARATIONS ROTTING (Git #2859, EPIC #1944 part 7).
 *
 * Read `./coverage.ts` first — it is the argument this file enforces. In short: moving a
 * roster of tenant-scoped tables into a per-module registry does not, on its own, stop the
 * roster rotting. A module that never declares a table it owns looks, at runtime, exactly
 * like a module that has no such table: the purge completes, reports a number, the rows
 * survive, and the tenant is stamped `post_termination_purged_at` so nothing ever looks
 * again.
 *
 * So this asks the RUNNING DATABASE what is tenant-scoped and fails on anything nobody has
 * accounted for. It is a live-DB test on purpose — the ORM schema is exactly what cannot
 * be trusted here, since eleven genuinely tenant-scoped tables (`scope_creep_*`, `sla_*`,
 * `war_room_interaction_events`) exist only as manual migrations with no Drizzle
 * definition at all.
 *
 * Skips cleanly with no `DATABASE_URL`. Read-only: it queries the catalog and nothing else.
 *
 * Run: pnpm --filter @workspace/api-server vitest run tenant-scope-coverage.live-db
 */

import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ALL_TENANT_DATA_PURGER_DECLARATIONS } from "./modules.ts";
import {
  TENANT_SCOPE_PURGE_EXEMPTIONS,
  TENANT_SCOPE_UNCLAIMED,
  declaredTenantScopeKeys,
  findUnaccountedTenantScopedColumns,
  readTenantScopedColumns,
} from "./coverage.ts";
import { declareTenantDataPurger } from "./declare.ts";

describe.skipIf(!process.env.DATABASE_URL)("#2859 — every tenant-scoped table is accounted for", () => {
  it("leaves no live tenant-scoped column undeclared and unexempted", async () => {
    const unaccounted = await findUnaccountedTenantScopedColumns();
    // The message matters as much as the assertion: whoever added the table needs to be
    // told to declare it on the owning module or exempt it with a reason, not just that a
    // count changed.
    expect(
      unaccounted,
      `These live tenant-scoped columns are claimed by no purger and carry no exemption:\n` +
        unaccounted.map((k) => `  - ${k}`).join("\n") +
        `\n\nDeclare each on the module that owns it (purgers/modules.ts), or add it to ` +
        `TENANT_SCOPE_PURGE_EXEMPTIONS (purgers/coverage.ts) with the real reason it survives ` +
        `a 7-year post-termination purge.`,
    ).toEqual([]);
  });

  it("declares no table or column that does not actually exist", async () => {
    // A typo in a declared name is invisible at runtime: `to_regclass` says the relation is
    // absent, the purge records it as skipped, and a real table full of a real customer's
    // rows is never touched. Local dev carries the most complete schema, so a name missing
    // HERE is a typo, not the staging-lag case the skip exists for.
    const live = await db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
    `);
    const real = new Set(live.rows.map((r) => `${r.table_name}.${r.column_name}`));

    const missing: string[] = [];
    for (const declaration of ALL_TENANT_DATA_PURGER_DECLARATIONS) {
      for (const target of declaration.targets) {
        for (const column of [target.column, target.orColumn].filter(Boolean) as string[]) {
          if (!real.has(`${target.table}.${column}`)) {
            missing.push(`${declaration.key}: ${target.table}.${column}`);
          }
        }
      }
    }
    expect(missing, `Declared purge targets that do not exist in this database:\n${missing.join("\n")}`).toEqual([]);
  });

  it("keys every declared target in an id space the database agrees with", async () => {
    // The failure this catches is the worst one available: a target keyed in the wrong id
    // space either destroys a DIFFERENT customer's rows or destroys nothing, and neither
    // raises an error. A `tenantGuid` target must be text; a `customerId` target must be
    // integer. Nothing here can prove the SEMANTIC choice is right, but the type mismatch
    // is mechanical and catches the transposition.
    const live = await readTenantScopedColumns();
    const typeOf = new Map(live.map((c) => [`${c.table}.${c.column}`, c.dataType]));

    const wrong: string[] = [];
    for (const declaration of ALL_TENANT_DATA_PURGER_DECLARATIONS) {
      for (const target of declaration.targets) {
        const dataType = typeOf.get(`${target.table}.${target.column}`);
        if (dataType === undefined) continue; // covered by the existence test above
        const expected = target.keySpace === "tenantGuid" ? "text" : "integer";
        if (dataType !== expected) {
          wrong.push(`${declaration.key}: ${target.table}.${target.column} is ${dataType}, keySpace ${target.keySpace} expects ${expected}`);
        }
      }
    }
    expect(wrong, `Targets whose declared id space contradicts the column's real type:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("gives every exemption a real reason, not a bare entry", () => {
    const thin = Object.entries(TENANT_SCOPE_PURGE_EXEMPTIONS).filter(([, reason]) => reason.trim().length < 40);
    expect(thin.map(([k]) => k), "An exemption with no real reason is a silent omission with extra steps").toEqual([]);
  });

  it("makes every UNCLAIMED column name the issue that closes it", () => {
    // An unclaimed entry is an open hole in an irreversible purge, not a decision. It is
    // allowed to exist — a table can genuinely arrive from a module that has not declared
    // it yet — but only while it points at the issue that will. Without that, the category
    // becomes the rot-hatch the whole file exists to close.
    const unreferenced = Object.entries(TENANT_SCOPE_UNCLAIMED).filter(([, reason]) => !/#\d+/.test(reason));
    expect(
      unreferenced.map(([k]) => k),
      "An unclaimed tenant-scoped column with no issue number is a gap nobody has been asked to close",
    ).toEqual([]);

    // Printed on every run so a long-lived entry stays visible rather than settling in.
    const open = Object.keys(TENANT_SCOPE_UNCLAIMED);
    if (open.length > 0) {
      console.warn(`retention: ${open.length} tenant-scoped column(s) NOT purged, awaiting their module: ${open.join(", ")}`);
    }
  });

  it("never both declares and exempts the same column", () => {
    const declared = declaredTenantScopeKeys();
    const accounted = { ...TENANT_SCOPE_PURGE_EXEMPTIONS, ...TENANT_SCOPE_UNCLAIMED };
    const both = Object.keys(accounted).filter((k) => declared.has(k));
    expect(both, "A column cannot both be purged and be recorded as not purged").toEqual([]);

    const contradictory = Object.keys(TENANT_SCOPE_UNCLAIMED).filter((k) => k in TENANT_SCOPE_PURGE_EXEMPTIONS);
    expect(contradictory, "A column cannot be both deliberately retained and an unclosed gap").toEqual([]);
  });

  it("gives each module a unique key and each module a unique target", () => {
    const keys = ALL_TENANT_DATA_PURGER_DECLARATIONS.map((d) => d.key);
    expect(new Set(keys).size, "two declarations sharing a key would decide by import order").toBe(keys.length);

    // declareTenantDataPurger refuses a duplicated target within one module; assert the
    // same across modules, where the consequence is double-counting in the audit account.
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const declaration of ALL_TENANT_DATA_PURGER_DECLARATIONS) {
      declareTenantDataPurger(declaration); // throws on an intra-module duplicate
      for (const target of declaration.targets) {
        const id = `${target.table}.${target.column}`;
        const owner = seen.get(id);
        if (owner) dupes.push(`${id} claimed by both "${owner}" and "${declaration.key}"`);
        else seen.set(id, declaration.key);
      }
    }
    expect(dupes, `Two modules claiming one table double-count rows only one of them destroyed:\n${dupes.join("\n")}`).toEqual([]);
  });
});
