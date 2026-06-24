import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAuth";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRIZZLE_DIR = path.resolve(__dirname, "../../../../lib/db/drizzle");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta/_journal.json");

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface MigrationRow {
  tag: string;
  applied_at: string;
}

function readJournal(): JournalEntry[] {
  if (!fs.existsSync(JOURNAL_PATH)) return [];
  const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8")) as Journal;
  return j.entries ?? [];
}

function spawnScript(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { cwd, env, timeout: 20_000 });
    const chunks: string[] = [];
    child.stdout?.on("data", (chunk: string) => chunks.push(chunk.toString()));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(chunks.join(""));
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

// GET /admin/db-status
router.get("/admin/db-status", requireAdmin, async (req: Request, res: Response) => {
  const entries = readJournal();
  const journalCount = entries.length;

  // Dev DB — query via existing drizzle connection
  let devApplied: MigrationRow[] = [];
  try {
    const result = await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        "tag"        text        PRIMARY KEY,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    void result; // ensure table exists
    const rows = await db.execute(sql`SELECT tag, applied_at::text AS applied_at FROM __drizzle_migrations ORDER BY tag`);
    // drizzle db.execute returns QueryResult; rows is in .rows
    const rawRows = (rows as unknown as { rows: MigrationRow[] }).rows ?? (Array.isArray(rows) ? rows as unknown as MigrationRow[] : []);
    devApplied = rawRows;
  } catch (err) {
    (req as unknown as { log: { warn: (msg: string, e: unknown) => void } }).log?.warn("db-status: could not query dev __drizzle_migrations", err);
  }

  const devAppliedSet = new Set(devApplied.map(r => r.tag));
  const lastDevRow = devApplied[devApplied.length - 1] ?? null;
  const devPending = entries.filter(e => !devAppliedSet.has(e.tag));

  // Prod DB — spawn scripts/migration-status.ts (has pg as dep)
  const workspaceRoot = path.resolve(__dirname, "../../../../");
  const hasProdUrl = !!(process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"]);

  interface ProdStatusResult {
    ok: boolean;
    error?: string;
    journalCount: number;
    appliedCount: number;
    lastAppliedTag: string | null;
    lastAppliedAt: string | null;
    pendingCount: number;
    pendingTags: string[];
  }

  let prodResult: { available: true } & Omit<ProdStatusResult, "ok"> | { available: false; reason: string };

  if (!hasProdUrl) {
    prodResult = { available: false, reason: "PROD_DATABASE_URL is not set" };
  } else {
    try {
      const output = await spawnScript(
        "pnpm --filter @workspace/scripts run migration-status",
        workspaceRoot,
        { ...process.env }
      );
      const jsonLine = output.trim().split("\n").reverse().find(l => l.startsWith("{"));
      if (!jsonLine) throw new Error("No JSON output from migration-status script");
      const parsed = JSON.parse(jsonLine) as ProdStatusResult;
      if (!parsed.ok) {
        prodResult = { available: false, reason: parsed.error ?? "Unknown error from migration-status" };
      } else {
        prodResult = {
          available: true,
          journalCount: parsed.journalCount,
          appliedCount: parsed.appliedCount,
          lastAppliedTag: parsed.lastAppliedTag,
          lastAppliedAt: parsed.lastAppliedAt,
          pendingCount: parsed.pendingCount,
          pendingTags: parsed.pendingTags,
        };
      }
    } catch (err) {
      prodResult = {
        available: false,
        reason: err instanceof Error ? err.message : "Could not run migration-status script",
      };
    }
  }

  res.json({
    journalCount,
    dev: {
      appliedCount: devApplied.length,
      lastAppliedTag: lastDevRow?.tag ?? null,
      lastAppliedAt: lastDevRow?.applied_at ?? null,
      pendingCount: devPending.length,
      pendingTags: devPending.map(e => e.tag),
    },
    prod: prodResult,
  });
});

// POST /admin/db-migrate — runs the migrate-prod script against production
router.post("/admin/db-migrate", requireAdmin, async (req: Request, res: Response) => {
  const prodUrl = process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"];
  if (!prodUrl) {
    res.status(400).json({ error: "PROD_DATABASE_URL is not set — cannot run production migration." });
    return;
  }

  const workspaceRoot = path.resolve(__dirname, "../../../../");
  const logger = (req as unknown as { log: { info: (msg: string) => void; error: (o: object, msg: string) => void } }).log;
  logger?.info("POST /admin/db-migrate — spawning migrate-prod");

  const lines: string[] = [];

  exec(
    "pnpm --filter @workspace/scripts run migrate-prod",
    { cwd: workspaceRoot, timeout: 120_000, env: { ...process.env } },
    (err, stdout, stderr) => {
      const combined = [...stdout.split("\n"), ...stderr.split("\n")].filter(Boolean);
      lines.push(...combined);

      if (err) {
        logger?.error({ err }, "migrate-prod failed");
        res.status(500).json({ ok: false, error: err.message, output: lines });
      } else {
        logger?.info("migrate-prod completed successfully");
        res.json({ ok: true, output: lines });
      }
    }
  );
});

export default router;
