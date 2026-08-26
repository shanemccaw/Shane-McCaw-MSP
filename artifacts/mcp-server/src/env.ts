import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads the repo root .env.local into process.env. Already-set variables win,
 * so a real environment override always beats the file. The MCP server is its
 * own process — it does not inherit the api-server's env — but it must read
 * the SAME JWT_SECRET/DATABASE_URL the local api-server runs with, and the
 * repo root .env.local is where those live for local dev.
 */
export function loadEnvLocal(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) {
      applyEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // No .env.local found — rely on the ambient environment (e.g. when pointed
  // at Staging over SSH, where the secrets come from the environment itself).
}

function applyEnvFile(path: string): void {
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required but not set — expected in the repo root .env.local or the environment`,
    );
  }
  return value;
}

/** Base URL every tool's API call is made against. Path segments passed to
 * apiFetch are appended to this, so tools use the same route paths the rest
 * of the codebase talks about (e.g. "/admin/clients/enriched"). */
export function apiBaseUrl(): string {
  return process.env.MCP_API_BASE_URL ?? "http://localhost:8080/api";
}

/** The operator account this server runs as. Overridable for the day the
 * email changes — but the resolved row must be role='admin' (auth.ts). */
export function operatorEmail(): string {
  return process.env.MCP_OPERATOR_EMAIL ?? "shane@shanemccaw.com";
}
