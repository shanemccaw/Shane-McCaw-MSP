// Real environment resolution. Everything secret comes from the environment (a local .env
// file that is gitignored, or Replit's own Secrets) -- never from a checked-in constant.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Minimal .env loader. Node 20 has no built-in one and this app deliberately carries a single
 * runtime dependency (pg), so parsing KEY=VALUE ourselves is cheaper than adding dotenv.
 * On Replit there is no .env file at all -- Secrets arrive as real process env vars.
 */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
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

loadEnvFile(resolve(ROOT, ".env"));

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy web/shanes-life/.env.example to .env and fill in real values ` +
        `(or set it as a Replit Secret on the deployment).`,
    );
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || "development";
const port = Number(process.env.PORT || 5000);

export const config = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port,
  host: "0.0.0.0",
  databaseUrl: required("DATABASE_URL"),
  // Replit's Postgres (and Neon) require TLS; a local install does not.
  databaseSsl:
    (process.env.PGSSLMODE || "").toLowerCase() === "require" ||
    /[?&]sslmode=require/.test(process.env.DATABASE_URL || ""),
  publicOrigin: (process.env.PUBLIC_ORIGIN || `http://localhost:${port}`).replace(/\/+$/, ""),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 12_000_000),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  root: ROOT,
};
