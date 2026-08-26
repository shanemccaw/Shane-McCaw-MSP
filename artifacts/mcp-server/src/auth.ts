import jwt from "jsonwebtoken";
import pg from "pg";
import { operatorEmail, requiredEnv } from "./env.ts";
import { logger } from "./logger.ts";

/**
 * The identity every MCP tool call runs as — Shane's own real users row,
 * resolved fresh from the same local Postgres the api-server reads. This
 * server is Shane's personal operating tool: it refuses to start as any
 * account whose role is not 'admin' (legacy PlatformAdmin).
 */
export interface OperatorIdentity {
  id: number;
  email: string;
  name: string | null;
  role: "admin";
  mspRole: string | null;
  mspId: number | null;
  customerId: number | null;
  mspSlug: string | null;
}

let cachedIdentity: OperatorIdentity | null = null;

export async function resolveOperatorIdentity(): Promise<OperatorIdentity> {
  if (cachedIdentity) return cachedIdentity;

  const client = new pg.Client({ connectionString: requiredEnv("DATABASE_URL") });
  await client.connect();
  try {
    const email = operatorEmail();
    const { rows } = await client.query(
      `SELECT u.id, u.email, u.name, u.role, u.msp_role, u.msp_id, u.tenant_id,
              m.slug AS msp_slug
         FROM users u
         LEFT JOIN msps m ON m.id = u.msp_id
        WHERE lower(u.email) = lower($1)
        LIMIT 1`,
      [email],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(
        `No users row found for ${email} — set MCP_OPERATOR_EMAIL to the real operator account`,
      );
    }
    if (row.role !== "admin") {
      throw new Error(
        `${email} has role '${row.role}', not 'admin' — this server only runs as the platform operator`,
      );
    }
    cachedIdentity = {
      id: row.id,
      email: row.email,
      name: row.name ?? null,
      role: "admin",
      mspRole: row.msp_role ?? null,
      mspId: row.msp_id ?? null,
      customerId: row.tenant_id ?? null,
      mspSlug: row.msp_slug ?? null,
    };
    logger.info(
      { userId: cachedIdentity.id, email: cachedIdentity.email, mspRole: cachedIdentity.mspRole },
      "operator identity resolved",
    );
    return cachedIdentity;
  } finally {
    await client.end();
  }
}

// Same ACCESS_TOKEN_TTL as routes/auth.ts issues for real login sessions.
const TOKEN_TTL_MS = 15 * 60_000;
// Re-mint this long before expiry so no in-flight call ever carries a token
// that dies mid-request.
const REFRESH_MARGIN_MS = 60_000;

let cachedToken: { token: string; expiresAtMs: number } | null = null;

/**
 * Mints (and caches) a short-lived access token for the operator, signed with
 * the platform's own JWT_SECRET. The payload mirrors routes/auth.ts's
 * buildUserPayload claims (the subset requireAuth/requireAdmin/requireRole
 * actually read: id, email, name, role, mspRole, mspId, customerId, mspSlug),
 * so to the api-server this session is indistinguishable from a real
 * /auth/login session of Shane's — every route middleware, request-log
 * enrichment and audit attribution applies unchanged, with no api-server
 * changes and no parallel auth mechanism to maintain.
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - now > REFRESH_MARGIN_MS) {
    return cachedToken.token;
  }

  const op = await resolveOperatorIdentity();
  const payload = {
    id: op.id,
    email: op.email,
    ...(op.name ? { name: op.name } : {}),
    role: op.role,
    ...(op.mspRole ? { mspRole: op.mspRole } : {}),
    ...(op.mspId != null ? { mspId: op.mspId } : {}),
    ...(op.customerId != null ? { customerId: op.customerId } : {}),
    ...(op.mspSlug ? { mspSlug: op.mspSlug } : {}),
  };
  const token = jwt.sign(payload, requiredEnv("JWT_SECRET"), {
    expiresIn: Math.floor(TOKEN_TTL_MS / 1000),
  });
  cachedToken = { token, expiresAtMs: now + TOKEN_TTL_MS };
  logger.info({ userId: op.id }, "minted operator access token");
  return token;
}
