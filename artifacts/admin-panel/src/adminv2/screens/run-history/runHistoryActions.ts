/**
 * Re-running a logged run.
 *
 * Isolated in its own module on purpose. `runHistoryStore` is imported *by*
 * `sqlStore` (it reports its runs into it), so it must never import it back.
 * Everything that needs to reach into that store lives here instead, and
 * only the screen's UI imports this file — so the dependency graph stays
 * acyclic:
 *
 *   sqlStore ─> runHistoryStore
 *
 *   runHistoryActions ─> sqlStore   (nothing imports this but the UI)
 *
 * There is no new execution path here. A re-run goes through exactly the same
 * `runQueryText`/`runMigrationFile` the original went through, so it is
 * logged again the same way, arrives in the same console/output panel, and is
 * subject to the same real consequences. That is the point: this screen does
 * not get a private, quieter way to run things.
 *
 * The Git & Deploy Console this also used to replay `"deploy"`-kind entries
 * through was removed in full (Git #3679) — a `"deploy"`-kind row is now
 * read-only history; there is nowhere left to replay it into.
 */

import { getShellApi } from "../../shell/ShellContext";
import { runMigrationFile, runQueryText, setDraftQuery, startDraft } from "../sql/sqlStore";
import type { RunHistoryEntry } from "./runHistoryTypes";

/**
 * Re-runs the entry through its owning screen.
 *
 * A migration is confirmed here rather than armed in place, matching what the
 * SQL Runner's own "Run migration" already does — this is the one re-run that
 * can write to the live database from text nobody in this session has read.
 */
export function rerunEntry(entry: RunHistoryEntry): void {
  if (entry.migrationFile) {
    const proceed =
      typeof window === "undefined" ||
      window.confirm(`Run "${entry.migrationFile}" against the real database again? This cannot be undone from here.`);
    if (!proceed) return;
    getShellApi()?.navigate("/sql");
    getShellApi()?.dispatch({ type: "setBottomTab", id: "sql-output" });
    void runMigrationFile(entry.migrationFile);
    return;
  }

  if (entry.kind === "sql") {
    // Into the editor first, then run — so a query that turns out to be wrong
    // is sitting in front of you to fix rather than only in the log.
    startDraft();
    setDraftQuery(entry.cmd);
    getShellApi()?.navigate("/sql");
    getShellApi()?.dispatch({ type: "setBottomTab", id: "sql-output" });
    void runQueryText(entry.cmd);
    return;
  }

  // Deploy: the console this replayed through is gone (Git #3679). A
  // deploy-kind row is historical read-only data now — there is nowhere left
  // to replay it into.
  if (typeof window !== "undefined") {
    window.alert('The Git & Deploy Console has been removed. This run can no longer be replayed — it is read-only history.');
  }
}
