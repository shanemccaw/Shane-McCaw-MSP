/**
 * probe-graph-permissions.ts
 *
 * Probes a set of Microsoft Graph application-level permissions by acquiring
 * a Graph access token with the client's credentials and making lightweight
 * read-only requests to each permission's representative endpoint.
 *
 * Returns three buckets:
 *   granted      — endpoint returned 200/204 (permission is active)
 *   missing      — endpoint returned 401/403 (permission not granted)
 *   unverifiable — endpoint was not reachable, not mapped, or is inherently
 *                  impossible to probe via a simple REST call (e.g. Exchange.ManageAsApp)
 *
 * NEVER throws — always returns a result object.
 */

import { ClientSecretCredential } from "@azure/identity";

export interface PermissionProbeResult {
  granted: string[];
  missing: string[];
  unverifiable: string[];
  checkedAt: string;
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * Permissions that cannot be probed via a simple Graph REST call.
 * These are always returned in the `unverifiable` bucket.
 */
const ALWAYS_UNVERIFIABLE = new Set([
  "Exchange.ManageAsApp",
]);

/**
 * Maps each known Graph application permission to the cheapest read-only
 * endpoint that will return 200 when granted and 403 when missing.
 */
const PROBE_MAP: Record<string, string> = {
  "User.Read.All":                     `${GRAPH_BASE}/users?$top=1&$select=id`,
  "Group.Read.All":                    `${GRAPH_BASE}/groups?$top=1&$select=id`,
  "Directory.Read.All":                `${GRAPH_BASE}/directoryObjects?$top=1&$select=id`,
  "RoleManagement.Read.Directory":     `${GRAPH_BASE}/roleManagement/directory/roleDefinitions?$top=1&$select=id`,
  "AuditLog.Read.All":                 `${GRAPH_BASE}/auditLogs/signIns?$top=1&$select=id`,
  "SecurityEvents.Read.All":           `${GRAPH_BASE}/security/alerts?$top=1&$select=id`,
  "Mail.Read":                         `${GRAPH_BASE}/users?$top=1&$select=mail`,
  "MailboxSettings.Read":              `${GRAPH_BASE}/users?$top=1&$select=mailboxSettings`,
  "Sites.Read.All":                    `${GRAPH_BASE}/sites?$top=1&$select=id`,
  "Files.Read.All":                    `${GRAPH_BASE}/drives?$top=1&$select=id`,
  "Team.ReadBasic.All":                `${GRAPH_BASE}/teams?$top=1&$select=id`,
  "TeamSettings.Read.All":             `${GRAPH_BASE}/teams?$top=1&$select=id,memberSettings`,
  "Channel.ReadBasic.All":             `${GRAPH_BASE}/teams?$top=1&$select=id`,
  "Organization.Read.All":             `${GRAPH_BASE}/organization?$select=id`,
  "Reports.Read.All":                  `${GRAPH_BASE}/reports/getOffice365ActiveUserCounts(period='D7')`,
  "ThreatAssessment.Read.All":         `${GRAPH_BASE}/informationProtection/threatAssessmentRequests?$top=1`,
  "Compliance.Read.All":               `${GRAPH_BASE}/compliance`,
};

/**
 * Acquires a Graph token with the supplied credentials and probes each
 * permission in parallel. Returns a result object — never throws.
 */
export async function probeGraphPermissions(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  permissions: string[],
): Promise<PermissionProbeResult> {
  const checkedAt = new Date().toISOString();

  if (permissions.length === 0) {
    return { granted: [], missing: [], unverifiable: [], checkedAt };
  }

  let accessToken: string;
  try {
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
    if (!tokenResponse?.token) {
      return { granted: [], missing: [], unverifiable: permissions, checkedAt };
    }
    accessToken = tokenResponse.token;
  } catch {
    return { granted: [], missing: [], unverifiable: permissions, checkedAt };
  }

  const granted: string[] = [];
  const missing: string[] = [];
  const unverifiable: string[] = [];

  await Promise.all(
    permissions.map(async (perm) => {
      if (ALWAYS_UNVERIFIABLE.has(perm) || !PROBE_MAP[perm]) {
        unverifiable.push(perm);
        return;
      }
      try {
        const res = await fetch(PROBE_MAP[perm], {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 200 || res.status === 204) {
          granted.push(perm);
        } else if (res.status === 401 || res.status === 403) {
          missing.push(perm);
        } else {
          unverifiable.push(perm);
        }
      } catch {
        unverifiable.push(perm);
      }
    }),
  );

  return { granted, missing, unverifiable, checkedAt };
}
