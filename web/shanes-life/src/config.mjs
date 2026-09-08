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
  // The bill-payment vault's AES-256-GCM key (migration 017). Outside the database on purpose,
  // so a dump on its own decrypts nothing. Read here rather than at the call site so the Vault
  // Feature cannot accidentally ship reading it from somewhere else.
  vaultKey: process.env.SL_VAULT_KEY ? Buffer.from(process.env.SL_VAULT_KEY, "base64") : null,
  // Plaid (Git #3168). Read here, never at a call site, so no route can build a request that
  // logs the secret. Absent credentials are a real, reportable state -- the Banks screen says
  // "not configured" out loud rather than showing a broken button.
  plaidClientId: process.env.SL_PLAID_CLIENT_ID || null,
  plaidSecret: process.env.SL_PLAID_SECRET || null,
  plaidEnv: process.env.SL_PLAID_ENV || "production",
  // Only set when the URI is genuinely registered in the Plaid dashboard -- Plaid rejects an
  // unregistered redirect_uri outright, so the variable's presence is the proof of registration.
  plaidRedirectUri: process.env.SL_PLAID_REDIRECT_URI || null,
  // Real Tesla Fleet API (Git #3158). Read here, never at a call site, same reasoning as Plaid
  // above -- absent credentials are a real, reportable state, not a silent broken button.
  teslaClientId: process.env.TESLA_CLIENT_ID || null,
  teslaClientSecret: process.env.TESLA_CLIENT_SECRET || null,
  // The real registered redirect URI, developer.tesla.com app registration (per #3199's own
  // comment): https://<this app's host>/auth/tesla/callback. Only set once genuinely
  // registered there -- Tesla rejects an unregistered redirect_uri outright, same as Plaid.
  teslaRedirectUri: process.env.TESLA_REDIRECT_URI || null,
  // The real public key Tesla's vehicle-pairing flow fetches from
  // /.well-known/appspecific/com.tesla.3p.public-key.pem on the deployed domain. PEM text,
  // not a path -- Replit Secrets hold values, not files. The matching private key
  // (TESLA_PRIVATE_KEY) is reserved for the real vehicle-command signing this build
  // deliberately does not implement (see migration 055's header) and is not read here.
  teslaPublicKey: process.env.TESLA_PUBLIC_KEY || null,
  root: ROOT,
};
