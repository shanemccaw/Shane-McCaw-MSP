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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { SqlExplorer } from "./SqlExplorer";
import { SqlQueryOutputPanel } from "./SqlQueryOutput";

const fetchWithAuth = vi.fn();
const writeText = vi.fn();
const openDoc = vi.fn();
const dispatch = vi.fn();
const navigate = vi.fn();

vi.mock("../../shell/ShellContext", () => ({
  useShell: () => ({ state: { docs: [], activeDocId: null }, openDoc, dispatch, navigate }),
  getShellApi: () => ({ navigate, openDoc, dispatch }),
}));

beforeEach(() => {
  fetchWithAuth.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  openDoc.mockReset();
  dispatch.mockReset();
  navigate.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
  resetSqlStore();
  configureSqlFetch(fetchWithAuth);
});

afterEach(() => {
  resetSqlStore();
  cleanup();
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

describe("SqlExplorer right-click menus", () => {
  const sampleScript = {
    id: 1,
    name: "Seat counts",
    category: "Billing",
    query: "select 1;",
    isDestructive: false,
    isResetScript: false,
    createdAt: null,
    updatedAt: null,
  };
  const sampleMigration = { filename: "0001_test.sql", ranAt: null as string | null };

  beforeEach(async () => {
    fetchWithAuth.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/simulator/sql/scripts")) return { ok: true, json: async () => ({ scripts: [sampleScript] }) };
      if (url.includes("/simulator/migrations/files")) return { ok: true, json: async () => ({ files: [sampleMigration] }) };
      return { ok: true, json: async () => ({}) };
    });
    await loadScripts();
    await loadMigrations();
  });

  it("right-clicking a script row offers Open / Run it / Duplicate / Copy name / Delete", async () => {
    render(<SqlExplorer />);
    const row = await screen.findByText("Seat counts");

    fireEvent.contextMenu(row);
    expect(screen.getByRole("menu", { name: "Actions for Seat counts" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Run it" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy name" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy name" }));
    expect(writeText).toHaveBeenCalledWith("Seat counts");
  });

  it("Run it opens the script and runs its saved query, same as the contextual tab's own action", async () => {
    fetchWithAuth.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/simulator/sql/scripts")) return { ok: true, json: async () => ({ scripts: [sampleScript] }) };
      if (url.includes("/simulator/migrations/files")) return { ok: true, json: async () => ({ files: [sampleMigration] }) };
      if (url.includes("/simulator/sql/execute")) {
        return { ok: true, json: async () => ({ statements: [{ statementIndex: 0, statementText: "select 1;", success: true, rows: [], rowCount: 0, fields: [], executionMs: 1 }] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SqlExplorer />);
    const row = await screen.findByText("Seat counts");

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Run it" }));

    expect(openDoc).toHaveBeenCalledWith({ kind: "script", id: "1", screenId: "sql", label: "Seat counts" });
    expect(dispatch).toHaveBeenCalledWith({ type: "setBottomTab", id: "sql-output" });
  });

  it("Delete on a script row is gated by window.confirm, same as the contextual tab", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SqlExplorer />);
    const row = await screen.findByText("Seat counts");

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete saved script "Seat counts"? This cannot be undone.');
    // Declined — no delete request went out.
    expect(fetchWithAuth).not.toHaveBeenCalledWith(expect.stringContaining("/scripts/1"), expect.objectContaining({ method: "DELETE" }));
    confirmSpy.mockRestore();
  });

  it("right-clicking a migration row offers Open / Run migration / Copy filename", async () => {
    render(<SqlExplorer />);
    const row = await screen.findByText("0001_test");

    fireEvent.contextMenu(row);
    expect(screen.getByRole("menu", { name: "Actions for 0001_test.sql" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Run migration" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy filename" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy filename" }));
    expect(writeText).toHaveBeenCalledWith("0001_test.sql");
  });

  it("running a migration from its context menu is gated by window.confirm, same as the contextual tab", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SqlExplorer />);
    const row = await screen.findByText("0001_test");

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Run migration" }));

    expect(confirmSpy).toHaveBeenCalledWith('Run "0001_test.sql" against the real database now? This cannot be undone from here.');
    // Declined — nothing ran.
    expect(dispatch).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("confirming the migration run wires through to the same runMigrationFile call the contextual tab uses", async () => {
    fetchWithAuth.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/simulator/sql/scripts")) return { ok: true, json: async () => ({ scripts: [sampleScript] }) };
      if (url.includes("/simulator/migrations/files")) return { ok: true, json: async () => ({ files: [sampleMigration] }) };
      if (url.includes("/simulator/migrations/execute")) return { ok: true, json: async () => ({ statements: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SqlExplorer />);
    const row = await screen.findByText("0001_test");

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Run migration" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "setBottomTab", id: "sql-output" });
    confirmSpy.mockRestore();
  });
});

describe("SqlQueryOutput right-click menu", () => {
  it("right-clicking a statement block offers Copy statement text / Copy result as JSON, and never Run again", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        statements: [{ statementIndex: 0, statementText: "select 1;", success: true, rows: [{ x: 1 }], rowCount: 1, fields: ["x"], executionMs: 3 }],
      }),
    });
    await runQueryText("select 1;");
    render(<SqlQueryOutputPanel />);

    const row = (await screen.findByText("select 1;")).closest("div") as HTMLElement;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menu", { name: "Actions for statement #1" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy statement text" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy result as JSON" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /run again/i })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy statement text" }));
    expect(writeText).toHaveBeenCalledWith("select 1;");
  });

  it("disables Copy error on a successful statement and Copy result as JSON on a failed one", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        statements: [{ statementIndex: 0, statementText: "select bad;", success: false, rows: [], rowCount: 0, fields: [], executionMs: 1, error: "syntax error" }],
      }),
    });
    await runQueryText("select bad;");
    render(<SqlQueryOutputPanel />);

    const row = (await screen.findByText("select bad;")).closest("div") as HTMLElement;
    fireEvent.contextMenu(row);

    const copyResult = screen.getByRole("menuitem", { name: "Copy result as JSON" });
    expect(copyResult.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy error" }));
    expect(writeText).toHaveBeenCalledWith("syntax error");
  });
});
