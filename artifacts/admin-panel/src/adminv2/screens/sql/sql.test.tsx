// @vitest-environment jsdom
/**
 * SQL Runner's own contract coverage. `Shell.test.tsx` already covers
 * shell-chrome integration; this file covers what's specific to this screen:
 * registration legality (only open/create/global on the fixed `run` tab),
 * the `script`/`migration` peek resolvers reading back real store state, the
 * per-kind contextual tab, and the client-side dangerous-keyword safety net
 * that gates the arm-then-confirm Run button independent of a script's
 * stored `isDestructive` flag.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScreen, resetRegistry } from "../../registry/registry";
import { getLiveRibbonEntry } from "../../shell/liveRibbon";
import {
  configureSqlFetch,
  getSnapshot,
  loadMigrationContent,
  loadMigrations,
  loadScripts,
  resetSqlStore,
  runQueryText,
  setAutoCopy,
  setAutoCopyFormat,
  SQL_RIBBON_KEYS,
} from "./sqlStore";
import { containsDangerousKeyword } from "./sqlTypes";

const fetchWithAuth = vi.fn();
const writeText = vi.fn();

beforeEach(() => {
  fetchWithAuth.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  resetSqlStore();
  configureSqlFetch(fetchWithAuth);
});

afterEach(() => {
  resetSqlStore();
});

describe("containsDangerousKeyword", () => {
  it("flags delete/drop/truncate/alter as whole words", () => {
    expect(containsDangerousKeyword("select * from foo")).toBe(false);
    expect(containsDangerousKeyword("DELETE FROM foo WHERE id = 1")).toBe(true);
    expect(containsDangerousKeyword("drop table foo")).toBe(true);
    expect(containsDangerousKeyword("truncate foo")).toBe(true);
    expect(containsDangerousKeyword("alter table foo add column bar text")).toBe(true);
  });

  it("does not false-positive on a substring match", () => {
    // "updated_at" contains "date", not "alter"/"delete" — and must not trip.
    expect(containsDangerousKeyword("select updated_at from foo")).toBe(false);
  });
});

describe("registration", () => {
  it(
    "registers on the fixed run tab without violating the open/create/global rule",
    async () => {
      resetRegistry();
      // No vi.resetModules(): this file's own registry imports must resolve
      // against the same module instance "./index" registers into. Longer
      // timeout: "./index" pulls in @uiw/react-codemirror transitively (via
      // SqlEditorBody) — the heaviest first-transform of any adminv2 screen
      // module, and the default 5s test timeout flakes under full-suite
      // parallel transform contention even though it's comfortably fast alone.
      await import("./index");

      const screenModule = getScreen("sql");
      expect(screenModule).toBeTruthy();
      expect(screenModule?.route).toBe("/sql");
      const tabs = new Set(screenModule?.ribbon?.map((r) => r.tab));
      expect(tabs).toEqual(new Set(["run"]));

      const allCommands = (screenModule?.ribbon ?? []).flatMap((r) => [
        ...(r.group.large ?? []),
        ...(r.group.small ?? []),
        ...(r.group.row ?? []),
      ]);
      for (const cmd of allCommands) {
        expect(["open", "create", "global"]).toContain(cmd.intent);
      }
    },
    20000,
  );

  it("peeks.script resolves null before scripts load, real after", async () => {
    const screenModule = getScreen("sql")!;
    expect(screenModule.peeks?.script?.("1")).toBeNull();

    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        scripts: [
          { id: 1, name: "Seat counts", category: "Billing", query: "select 1;", isDestructive: false, isResetScript: false, createdAt: null, updatedAt: null },
        ],
      }),
    });
    await loadScripts();

    const model = screenModule.peeks?.script?.("1");
    expect(model?.kind).toBe("script");
    expect(model?.title).toBe("Seat counts");
    expect(model?.sub).toBe("Billing");
    expect(model?.tag).toBe("read only");
  });

  it("peeks.migration resolves null before migrations load, real after", async () => {
    const screenModule = getScreen("sql")!;
    expect(screenModule.peeks?.migration?.("0001_test.sql")).toBeNull();

    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ files: [{ filename: "0001_test.sql", ranAt: null }] }),
    });
    await loadMigrations();

    const model = screenModule.peeks?.migration?.("0001_test.sql");
    expect(model?.kind).toBe("migration");
    expect(model?.title).toBe("0001_test.sql");
    expect(model?.tag).toBe("never run");
  });

  it("contextualTab returns Script Tools only for an open, resolvable script", async () => {
    const screenModule = getScreen("sql")!;
    const resolver = screenModule.contextualTab as (ctx: { kind?: string; recordId?: string }) => { id: string } | null;

    expect(resolver({})).toBeNull();
    expect(resolver({ kind: "script", recordId: "999" })).toBeNull();

    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        scripts: [{ id: 1, name: "Seat counts", category: "Billing", query: "select 1;", isDestructive: false, isResetScript: false, createdAt: null, updatedAt: null }],
      }),
    });
    await loadScripts();

    expect(resolver({ kind: "script", recordId: "1" })?.id).toBe("sql-script-tools");
  });

  it("contextualTab returns Migration Tools only for an open, resolvable migration", async () => {
    const screenModule = getScreen("sql")!;
    const resolver = screenModule.contextualTab as (ctx: { kind?: string; recordId?: string }) => { id: string } | null;

    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ files: [{ filename: "0001_test.sql", ranAt: null }] }),
    });
    await loadMigrations();

    expect(resolver({ kind: "migration", recordId: "missing.sql" })).toBeNull();
    expect(resolver({ kind: "migration", recordId: "0001_test.sql" })?.id).toBe("sql-migration-tools");
  });
});

describe("loadMigrationContent", () => {
  it("fetches a migration file's real text once and caches it by filename", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ filename: "0001_test.sql", content: "create table foo (id serial primary key);" }),
    });

    await loadMigrationContent("0001_test.sql");
    expect(getSnapshot().migrationContent["0001_test.sql"]).toBe("create table foo (id serial primary key);");
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/simulator/migrations/0001_test.sql/content");

    // Already cached — a second call must not re-fetch.
    fetchWithAuth.mockClear();
    await loadMigrationContent("0001_test.sql");
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("surfaces a fetch failure without caching a value for that filename", async () => {
    fetchWithAuth.mockResolvedValue({ ok: false, json: async () => ({ error: "not found" }) });
    await loadMigrationContent("missing.sql");
    expect(getSnapshot().migrationContent["missing.sql"]).toBeUndefined();
    expect(getSnapshot().lastMessage).toBe("not found");
  });
});

describe("Auto copy", () => {
  const mockExecuteResponse = {
    ok: true,
    json: async () => ({
      statements: [{ statementIndex: 0, statementText: "select 1;", success: true, rows: [{ x: 1 }], rowCount: 1, fields: ["x"], executionMs: 3 }],
    }),
  };

  it("does not copy a result when off", async () => {
    fetchWithAuth.mockResolvedValue(mockExecuteResponse);
    await runQueryText("select 1;");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the result the moment a run finishes, in the chosen format", async () => {
    setAutoCopyFormat("json");
    fetchWithAuth.mockResolvedValue(mockExecuteResponse);
    await runQueryText("select 1;");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeText.mock.calls[0][0])[0]).toMatchObject({ success: true, rowCount: 1 });
  });

  it("copies as tab-separated table text when that's the chosen format", async () => {
    setAutoCopy(true);
    fetchWithAuth.mockResolvedValue(mockExecuteResponse);
    await runQueryText("select 1;");
    expect(writeText).toHaveBeenCalledWith("x\n1");
  });

  it("stays off after a run — turning it off does not silently flip back on", async () => {
    setAutoCopy(true);
    setAutoCopy(false);
    fetchWithAuth.mockResolvedValue(mockExecuteResponse);
    await runQueryText("select 1;");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("pushes toggle/format state into the live-ribbon overlay so the button updates immediately", () => {
    setAutoCopy(true);
    expect(getLiveRibbonEntry(SQL_RIBBON_KEYS.autoCopyToggle)?.active).toBe(true);

    setAutoCopyFormat("json");
    expect(getLiveRibbonEntry(SQL_RIBBON_KEYS.autoCopyJson)?.active).toBe(true);
    expect(getLiveRibbonEntry(SQL_RIBBON_KEYS.autoCopyTable)?.active).toBe(false);
  });
});
