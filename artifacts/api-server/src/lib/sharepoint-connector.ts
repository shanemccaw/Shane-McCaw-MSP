/**
 * sharepoint-connector.ts
 *
 * Dual-mode SharePoint connector for the MSP document pipeline.
 *
 * Modes:
 *   platform  — uses the platform's own App Registration (GRAPH_* env vars).
 *               Default for all MSPs unless they have opted into msp_owned mode.
 *   msp_owned — uses the MSP's own App Registration credentials stored in the
 *               msp_sharepoint_connectors table. The client secret is retrieved
 *               from Azure Key Vault (clientSecretRef) or from clientSecretPlain
 *               (dev/test only — never for production tenants).
 *
 * Upload deduplication:
 *   Every upload receives a SHA-256 content checksum. Before uploading, the
 *   caller should check msp_document_versions.content_hash to see if an
 *   identical file already has a sharepointFileId. If it does, the upload is
 *   skipped and the existing fileId is returned. This is enforced in the
 *   doc_save_sharepoint pipeline node.
 */

import { createHash } from "crypto";
import { db, mspSharepointConnectorsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { getAccessToken } from "./graph";

const log = logger.child({ channel: "integration.azure" });

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ── Token cache (per connector) ────────────────────────────────────────────────

interface TokenEntry { token: string; expiresAt: number }

const connectorTokenCache = new Map<string, TokenEntry>();

// ── Get token for a given connector ───────────────────────────────────────────

export async function getConnectorToken(opts: {
  mode: "platform" | "msp_owned";
  connectorId?: string;
}): Promise<string> {
  if (opts.mode === "platform" || !opts.connectorId) {
    return getAccessToken();
  }

  const cacheKey = `connector:${opts.connectorId}`;
  const cached = connectorTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const [connector] = await db
    .select()
    .from(mspSharepointConnectorsTable)
    .where(
      and(
        eq(mspSharepointConnectorsTable.connectorId, opts.connectorId),
        eq(mspSharepointConnectorsTable.isActive, true),
      ),
    )
    .limit(1);

  if (!connector) {
    throw new Error(`SharePoint connector not found or inactive: ${opts.connectorId}`);
  }

  const clientSecret = await resolveConnectorSecret(connector);

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: connector.clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${connector.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `MSP-owned connector token fetch failed for connector ${opts.connectorId}: ${res.status} ${text}`,
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const entry: TokenEntry = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  connectorTokenCache.set(cacheKey, entry);
  return entry.token;
}

// ── Resolve client secret ──────────────────────────────────────────────────────

async function resolveConnectorSecret(
  connector: typeof mspSharepointConnectorsTable.$inferSelect,
): Promise<string> {
  if (connector.clientSecretRef) {
    return resolveFromKeyVault(connector.clientSecretRef);
  }
  if (connector.clientSecretPlain) {
    if (process.env.NODE_ENV === "production") {
      log.warn(
        { connectorId: connector.connectorId },
        "sharepoint-connector: using plaintext client secret in production — configure clientSecretRef instead",
      );
    }
    return connector.clientSecretPlain;
  }
  throw new Error(
    `SharePoint connector ${connector.connectorId} has no client secret configured (set clientSecretRef or clientSecretPlain)`,
  );
}

async function resolveFromKeyVault(secretName: string): Promise<string> {
  const vaultUrl = process.env.AZURE_KEY_VAULT_URL;
  if (!vaultUrl) {
    throw new Error("AZURE_KEY_VAULT_URL is not configured — cannot retrieve connector secret from Key Vault");
  }

  const { SecretClient } = await import("@azure/keyvault-secrets");
  const { ClientSecretCredential } = await import("@azure/identity");

  const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!,
  );
  const client = new SecretClient(vaultUrl, credential);
  const secret = await client.getSecret(secretName);
  if (!secret.value) {
    throw new Error(`Key Vault secret '${secretName}' has no value`);
  }
  return secret.value;
}

// ── SHA-256 checksum helper ────────────────────────────────────────────────────

export function computeChecksum(content: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(typeof content === "string" ? Buffer.from(content, "utf8") : content);
  return hash.digest("hex");
}

// ── Upload file with idempotency ───────────────────────────────────────────────

export interface UploadResult {
  fileId: string;
  webUrl: string;
  checksum: string;
  sizeBytes: number;
  /** true when the file was already present and upload was skipped */
  deduplicated?: boolean;
}

export interface UploadOptions {
  /** Platform service principal is used when omitted. */
  mode?: "platform" | "msp_owned";
  connectorId?: string;
  /** Site ID resolved by the platform when in platform mode, or by the MSP connector when in msp_owned. */
  siteId: string;
  /** Relative folder path inside the site's default document library (e.g. "Documents/Contracts"). */
  folderPath: string;
  filename: string;
  buffer: Buffer;
  mimeType: string;
  /**
   * If provided, the upload is skipped and the existing result returned instead of uploading a duplicate.
   * The caller checks the document_versions table for a matching contentHash + sharepointFileId before calling.
   */
  existingFileId?: string;
  existingFileUrl?: string;
}

export async function uploadToSharePoint(opts: UploadOptions): Promise<UploadResult> {
  const checksum = computeChecksum(opts.buffer);

  if (opts.existingFileId && opts.existingFileUrl) {
    log.info(
      { fileId: opts.existingFileId, checksum },
      "sharepoint-connector: deduplication hit — skipping upload",
    );
    return {
      fileId: opts.existingFileId,
      webUrl: opts.existingFileUrl,
      checksum,
      sizeBytes: opts.buffer.length,
      deduplicated: true,
    };
  }

  const mode = opts.mode ?? "platform";
  const token = await getConnectorToken({ mode, connectorId: opts.connectorId });

  const cleanFolder = opts.folderPath.replace(/^\/|\/$/g, "");
  const encodedPath = cleanFolder
    ? cleanFolder
        .split("/")
        .filter(Boolean)
        .map(encodeURIComponent)
        .join("/") +
      "/" +
      encodeURIComponent(opts.filename)
    : encodeURIComponent(opts.filename);

  const endpoint = `${GRAPH_BASE}/sites/${opts.siteId}/drive/root:/${encodedPath}:/content`;

  log.info(
    { siteId: opts.siteId, folderPath: opts.folderPath, filename: opts.filename, mode },
    "sharepoint-connector: uploading file",
  );

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": opts.mimeType,
    },
    body: opts.buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `SharePoint upload failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as { id: string; webUrl: string; size?: number };

  log.info(
    { fileId: data.id, webUrl: data.webUrl, checksum },
    "sharepoint-connector: upload complete",
  );

  return {
    fileId: data.id,
    webUrl: data.webUrl,
    checksum,
    sizeBytes: data.size ?? opts.buffer.length,
  };
}

// ── Ensure a folder exists in a SharePoint site ────────────────────────────────

export async function ensureSharePointFolder(opts: {
  siteId: string;
  folderPath: string;
  mode?: "platform" | "msp_owned";
  connectorId?: string;
}): Promise<void> {
  const mode = opts.mode ?? "platform";
  const token = await getConnectorToken({ mode, connectorId: opts.connectorId });

  const parts = opts.folderPath
    .replace(/^\/|\/$/g, "")
    .split("/")
    .filter(Boolean);

  let currentPath = "";
  for (const part of parts) {
    const parentEndpoint = currentPath
      ? `${GRAPH_BASE}/sites/${opts.siteId}/drive/root:/${currentPath}:/children`
      : `${GRAPH_BASE}/sites/${opts.siteId}/drive/root/children`;

    const res = await fetch(parentEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: part,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      const isAlreadyExists =
        res.status === 409 ||
        text.includes("nameAlreadyExists") ||
        text.includes("409");
      if (!isAlreadyExists) {
        log.warn(
          { status: res.status, body: text.slice(0, 200), folderPart: part },
          "sharepoint-connector: ensureFolder non-fatal failure",
        );
      }
    }
    currentPath = currentPath ? `${currentPath}/${part}` : part;
  }
}

// ── Resolve site ID for a connector ────────────────────────────────────────────

export async function resolveConnectorSiteId(opts: {
  mode: "platform" | "msp_owned";
  connectorId?: string;
  siteUrl?: string;
}): Promise<string | null> {
  if (!opts.siteUrl) return null;

  const token = await getConnectorToken({ mode: opts.mode, connectorId: opts.connectorId });

  try {
    const parsed = new URL(opts.siteUrl);
    const hostname = parsed.hostname;
    const sitePath = parsed.pathname.replace(/\/$/, "");
    const res = await fetch(
      `${GRAPH_BASE}/sites/${encodeURIComponent(hostname)}:${sitePath}?$select=id,webUrl`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { id: string };
    return data.id;
  } catch {
    return null;
  }
}

// ── Evict token from cache (e.g. on 401) ──────────────────────────────────────

export function evictConnectorToken(connectorId: string): void {
  connectorTokenCache.delete(`connector:${connectorId}`);
}
