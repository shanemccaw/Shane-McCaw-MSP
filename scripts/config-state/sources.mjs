/**
 * #1794 — Where the configuration resource model comes from, and the rules that
 * decide what counts as "configuration surface".
 *
 * Both sources are PUBLISHED descriptions. Nothing here probes Microsoft Graph.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Gitignored download cache (repo-root/.cache/config-state). */
export const DEFAULT_CACHE_DIR = path.resolve(here, "../../.cache/config-state");

export const SOURCES = {
  graphMetadata: {
    "v1.0": "https://graph.microsoft.com/v1.0/$metadata",
    beta: "https://graph.microsoft.com/beta/$metadata",
  },
  // Microsoft's own machine-readable permissions reference (the Kibali-schema dataset
  // behind Graph Explorer). Graph's $metadata carries no permission information at
  // all, so without this every Graph-metadata-derived resource would be stuck at
  // "unknown" availability.
  graphPermissions:
    "https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-devx-content/dev/permissions/new/permissions.json",
  m365dsc: {
    // Microsoft365DSC is community-maintained open source (MIT), developed with
    // Microsoft involvement but NOT a Microsoft first-party product. Read here for
    // its factual resource→transport→permission map only.
    repo: "Microsoft365DSC/Microsoft365DSC",
    ref: "Dev",
    license: "MIT",
    url: "https://github.com/Microsoft365DSC/Microsoft365DSC",
  },
};

/**
 * The configuration surface, expressed as the Graph EntityContainer roots that hold
 * tenant *configuration* rather than user content. Scope named by #1794: identity,
 * policy, device management, groups, sharing, security — explicitly NOT user data,
 * mail content or files.
 *
 * Each root maps to the surface bucket its resources are classified into. Roots that
 * are absent from this map are excluded from the config model (see EXCLUDED_ROOTS for
 * the ones excluded on purpose, with the reason).
 */
export const CONFIG_SURFACE_ROOTS = {
  // ── Identity & directory ────────────────────────────────────────────────────
  identity: "identity",
  identityGovernance: "identity",
  identityProtection: "identity",
  authenticationMethodConfigurations: "identity",
  authenticationMethodsPolicy: "identity",
  identityProviders: "identity",
  invitations: "identity",
  users: "identity",
  contacts: "directory",
  directory: "directory",
  directoryObjects: "directory",
  directoryRoles: "directory",
  directoryRoleTemplates: "directory",
  organization: "directory",
  contracts: "directory",
  domains: "directory",
  domainDnsRecords: "directory",
  subscribedSkus: "licensing",
  scopedRoleMemberships: "directory",
  roleManagement: "directory",
  schemaExtensions: "directory",
  tenantRelationships: "directory",
  admin: "directory",

  // ── Policy ──────────────────────────────────────────────────────────────────
  policies: "policy",
  agreements: "policy",
  agreementAcceptances: "policy",
  dataPolicyOperations: "policy",
  privacy: "policy",
  compliance: "compliance",
  informationProtection: "compliance",

  // ── Applications & consent ──────────────────────────────────────────────────
  applications: "applications",
  applicationTemplates: "applications",
  appRoleAssignments: "applications",
  servicePrincipals: "applications",
  oauth2PermissionGrants: "applications",
  permissionGrants: "applications",
  certificateBasedAuthConfiguration: "identity",
  appCatalogs: "applications",

  // ── Groups & collaboration ──────────────────────────────────────────────────
  groups: "groups",
  groupSettings: "groups",
  groupSettingTemplates: "groups",
  groupLifecyclePolicies: "groups",
  teams: "teams",
  teamsTemplates: "teams",
  teamwork: "teams",
  employeeExperience: "teams",
  planner: "collaboration",
  solutions: "collaboration",

  // ── Devices ─────────────────────────────────────────────────────────────────
  deviceManagement: "device-management",
  deviceAppManagement: "device-management",
  devices: "device-management",
  print: "device-management",

  // ── Sharing (SharePoint / OneDrive configuration, not file content) ─────────
  sites: "sharing",
  storage: "sharing",

  // ── Security ────────────────────────────────────────────────────────────────
  security: "security",

  // ── Operational reporting used by the monitor catalog ───────────────────────
  reports: "reporting",
  auditLogs: "reporting",
  external: "integration",
  connections: "integration",
  copilot: "copilot",
};

/**
 * Roots deliberately excluded, with the reason, so the exclusion is auditable rather
 * than a silent omission. #1794: "Not user data, not mail content, not files."
 */
export const EXCLUDED_ROOTS = {
  me: "delegated-only signed-in-user shortcut; app-only collectors never use it",
  drives: "file content (data plane), not configuration",
  drive: "file content (data plane), not configuration",
  shares: "file content (data plane), not configuration",
  chats: "message content (data plane), not configuration",
  communications: "call/meeting records (data plane), not configuration",
  search: "query surface, holds no stored configuration",
  education: "EDU-only workload; out of platform scope",
  places: "facilities data, not security/compliance configuration",
  subscriptions: "change-notification plumbing owned by the platform, not tenant config",
  filterOperators: "synchronisation expression metadata, not tenant configuration",
  functions: "synchronisation expression metadata, not tenant configuration",
};

/**
 * Navigation-path segments never expanded, even under an included root: these are the
 * per-user / per-item data planes hanging off configuration containers.
 */
export const EXCLUDED_PATH_SEGMENTS = new Set([
  "messages", "mailFolders", "events", "calendar", "calendars", "contacts",
  "drive", "drives", "photo", "photos", "onenote", "insights", "people",
  "activities", "chats", "onlineMeetings", "presence", "joinedTeams",
  "manager", "directReports", "memberOf", "transitiveMemberOf", "ownedObjects",
  "createdObjects", "registeredDevices", "ownedDevices", "licenseDetails",
  "extensions", "items", "lists", "pages", "content",
]);

/** Workloads the M365DSC resource-name prefix maps onto. */
export const M365DSC_WORKLOAD_PREFIXES = [
  ["AAD", "AzureAD"],
  ["EXO", "ExchangeOnline"],
  ["Intune", "Intune"],
  ["SPO", "SharePointOnline"],
  ["OD", "OneDriveForBusiness"],
  ["Teams", "Teams"],
  ["SC", "SecurityCompliance"],
  ["O365", "Microsoft365Admin"],
  ["Planner", "Planner"],
  ["PP", "PowerPlatform"],
  ["Fabric", "Fabric"],
  ["Defender", "Defender"],
  ["Azure", "Azure"],
  ["M365DSC", "Microsoft365DSC"],
  ["Commerce", "Commerce"],
  ["VC", "VerifiableCredentials"],
  ["DevOps", "AzureDevOps"],
  ["Purview", "Purview"],
];

/** Resolve a M365DSC resource name to its workload by longest matching prefix. */
export function workloadForDscResource(name) {
  let best = null;
  for (const [prefix, workload] of M365DSC_WORKLOAD_PREFIXES) {
    if (name.startsWith(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, workload];
  }
  return best ? best[1] : "Other";
}

/** Surface bucket for a workload — keeps DSC-origin rows on the same vocabulary as Graph-origin rows. */
export const WORKLOAD_SURFACE = {
  AzureAD: "identity",
  ExchangeOnline: "exchange",
  Intune: "device-management",
  SharePointOnline: "sharing",
  OneDriveForBusiness: "sharing",
  Teams: "teams",
  SecurityCompliance: "compliance",
  Purview: "compliance",
  Defender: "security",
  Microsoft365Admin: "directory",
  Planner: "collaboration",
  PowerPlatform: "power-platform",
  Fabric: "power-platform",
  Azure: "azure",
  AzureDevOps: "azure",
  Commerce: "licensing",
  VerifiableCredentials: "identity",
  Microsoft365DSC: "tooling",
  Other: "other",
};
