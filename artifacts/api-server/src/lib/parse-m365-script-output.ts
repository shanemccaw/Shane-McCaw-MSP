/**
 * parse-m365-script-output.ts
 *
 * Deterministic extractor for M365 tenant discovery script output.
 * Runs before AI analysis so well-known fields are mapped directly
 * without relying on the model to guess field names or value types.
 *
 * Handles both:
 *  - Raw string output from Azure Automation (may contain embedded JSON)
 *  - Pre-parsed JSON objects from manual uploads
 */

// ── SKU friendly-name lookup ──────────────────────────────────────────────────
// Maps raw Microsoft SKU identifier → human-readable product name.
// Unknown identifiers pass through verbatim.
export const SKU_LOOKUP: Record<string, string> = {
  ENTERPRISEPACK:            "Office 365 E3",
  ENTERPRISEPREMIUM:         "Office 365 E5",
  STANDARDPACK:              "Office 365 E1",
  SPE_E3:                    "M365 E3",
  SPE_E5:                    "M365 E5",
  SPB:                       "M365 Business Premium",
  O365_BUSINESS_ESSENTIALS:  "M365 Business Basic",
  O365_BUSINESS_PREMIUM:     "M365 Business Standard",
  SMB_BUSINESS:              "M365 Business Basic",
  SMB_BUSINESS_PREMIUM:      "M365 Business Premium",
  M365_F1:                   "M365 F1",
  M365_F3:                   "M365 F3",
  DESKLESSPACK:              "Office 365 F1",
  FLOW_FREE:                 "Power Automate Free",
  POWER_BI_STANDARD:         "Power BI (free)",
  POWER_BI_PRO:              "Power BI Pro",
  POWER_BI_PREMIUM_USER:     "Power BI Premium Per User",
  PROJECTPREMIUM:            "Project Plan 5",
  PROJECTPROFESSIONAL:       "Project Plan 3",
  PROJECT_ESSENTIALS:        "Project Plan 1",
  VISIOCLIENT:               "Visio Plan 2",
  VISIOONLINE_PLAN1:         "Visio Plan 1",
  MCOSTANDARD:               "Skype for Business Online Plan 2",
  EXCHANGE_S_ENTERPRISE:     "Exchange Online Plan 2",
  EXCHANGESTANDARD:          "Exchange Online Plan 1",
  SHAREPOINTENTERPRISE:      "SharePoint Online Plan 2",
  SHAREPOINTSTANDARD:        "SharePoint Online Plan 1",
  TEAMS_EXPLORATORY:         "Microsoft Teams Exploratory",
  INTUNE_A:                  "Microsoft Intune",
  AAD_PREMIUM:               "Entra ID P1",
  AAD_PREMIUM_P2:            "Entra ID P2",
  EMS:                       "Enterprise Mobility + Security E3",
  EMSPREMIUM:                "Enterprise Mobility + Security E5",
  DEFENDER_ENDPOINT_P1:      "Defender for Endpoint P1",
  DEFENDER_ENDPOINT_P2:      "Defender for Endpoint P2",
  ATP_ENTERPRISE:            "Defender for Office 365 P1",
};

/** Resolve a raw SKU identifier to a human-readable name. */
export function resolveSKU(raw: string): string {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  return SKU_LOOKUP[upper] ?? trimmed;
}

// ── Auth method normalisation ─────────────────────────────────────────────────
// Maps script-level identifiers to the stored value keys used by the wizard.
const AUTH_VALUE_MAP: Record<string, string> = {
  password:             "password",
  passwordonly:         "password",
  "password only":      "password",
  mfa:                  "mfa",
  "mfa (per-user)":     "mfa",
  "per-user mfa":       "mfa",
  ssosaml:              "sso_saml",
  sso_saml:             "sso_saml",
  "sso/saml":           "sso_saml",
  "sso / saml":         "sso_saml",
  saml:                 "sso_saml",
  entraid:              "entra_id",
  entra_id:             "entra_id",
  "entra id":           "entra_id",
  azuread:              "entra_id",
  "azure ad":           "entra_id",
  conditionalaccess:    "conditional_access",
  conditional_access:   "conditional_access",
  "conditional access": "conditional_access",
  "conditional access policies": "conditional_access",
};

function normaliseAuthMethod(raw: string): string {
  return AUTH_VALUE_MAP[raw.trim().toLowerCase()] ?? raw.trim();
}

// ── Core extraction ───────────────────────────────────────────────────────────

function extractFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Tenant domain
  if (typeof data.tenantDomain === "string" && data.tenantDomain.trim()) {
    out.tenantDomain = data.tenantDomain.trim();
  }

  // Active user %
  if (data.activeUserPercent !== undefined) {
    const pct = Number(data.activeUserPercent);
    if (!isNaN(pct) && isFinite(pct)) out.activeUserPercent = String(Math.round(pct * 100) / 100);
  }

  // Security group count
  if (data.securityGroupCount !== undefined) {
    const n = Number(data.securityGroupCount);
    if (!isNaN(n) && isFinite(n)) out.securityGroupCount = String(Math.round(n));
  }

  // Licensed user count
  if (data.licensedUserCount !== undefined) {
    const n = Number(data.licensedUserCount);
    if (!isNaN(n) && isFinite(n)) out.licensedUserCount = String(Math.round(n));
  }

  // Employee / total user count (fallback for licensedUserCount)
  if (out.licensedUserCount === undefined && data.totalUserCount !== undefined) {
    const n = Number(data.totalUserCount);
    if (!isNaN(n) && isFinite(n)) out.licensedUserCount = String(Math.round(n));
  }

  // SharePoint sites
  if (data.sharepointSiteCount !== undefined) {
    const n = Number(data.sharepointSiteCount);
    if (!isNaN(n) && isFinite(n)) out.sharepointSiteCount = String(Math.round(n));
  }

  // Teams
  if (data.teamCount !== undefined) {
    const n = Number(data.teamCount);
    if (!isNaN(n) && isFinite(n)) out.teamCount = String(Math.round(n));
  }

  // Guest user count
  if (data.guestUserCount !== undefined) {
    const n = Number(data.guestUserCount);
    if (!isNaN(n) && isFinite(n)) out.guestUserCount = Math.round(n);
  }

  // Org / tenant name
  if (typeof data.orgName === "string" && data.orgName.trim()) {
    out.orgName = data.orgName.trim();
  } else if (typeof data.tenantName === "string" && data.tenantName.trim()) {
    out.orgName = data.tenantName.trim();
  } else if (typeof data.displayName === "string" && data.displayName.trim()) {
    out.orgName = data.displayName.trim();
  }

  // Workload flags
  for (const key of [
    "usesExchange", "usesTeams", "usesSharePoint", "usesOneDrive", "usesYammer",
  ] as const) {
    if (key in data && data[key] !== undefined) {
      out[key] = Boolean(data[key]);
    }
  }

  // License SKUs — handle array or comma/semicolon-delimited string
  const rawSKUs =
    data.licenseSKUs ??
    data.licenseSkus ??
    data.licenseSku ??
    data.assignedSKUs ??
    data.assignedSkus;
  if (rawSKUs !== undefined) {
    let skuList: string[] = [];
    if (Array.isArray(rawSKUs)) {
      skuList = rawSKUs.map(s => resolveSKU(String(s))).filter(Boolean);
    } else if (typeof rawSKUs === "string" && rawSKUs.trim()) {
      skuList = rawSKUs
        .split(/[,;|]/)
        .map(s => resolveSKU(s.trim()))
        .filter(Boolean);
    }
    if (skuList.length > 0) out.licenseSKUs = skuList;
  }

  // Auth method — handle single string or array; normalise to value keys
  const rawAuth = data.authMethod ?? data.authMethods ?? data.primaryAuthMethod;
  if (rawAuth !== undefined) {
    let methods: string[] = [];
    if (Array.isArray(rawAuth)) {
      methods = rawAuth
        .map(a => normaliseAuthMethod(String(a)))
        .filter(Boolean);
    } else if (typeof rawAuth === "string" && rawAuth.trim()) {
      methods = rawAuth
        .split(/[,;|]/)
        .map(a => normaliseAuthMethod(a.trim()))
        .filter(Boolean);
    }
    if (methods.length > 0) out.authMethods = [...new Set(methods)];
  }

  // Boolean configuration flags
  const booleanFlags = [
    "mfaEnforced",
    "conditionalAccessEnabled",
    "isMicrosoftPartner",
    "allUsersLicensed",
    "externalSharingEnabled",
    "guestUsersPresent",
    "isHybrid",
    "hasOnPremExchange",
    "usesAADConnect",
    "intuneEnabled",
    "hasAADP1orP2",
    "hasDefender",
    "hasDLP",
    "usesComplianceCenter",
    "sensitivityLabelsConfigured",
    "hasRetentionPolicies",
    "hasInsiderRisk",
    "hasCopilotLicenses",
  ] as const;

  for (const key of booleanFlags) {
    if (key in data && data[key] !== undefined) {
      out[key] = Boolean(data[key]);
    }
  }

  // Numeric extras
  if (data.conditionalAccessPoliciesCount !== undefined) {
    const n = Number(data.conditionalAccessPoliciesCount);
    if (!isNaN(n) && isFinite(n)) out.conditionalAccessPoliciesCount = Math.round(n);
  }
  if (data.copilotLicenseCount !== undefined) {
    const n = Number(data.copilotLicenseCount);
    if (!isNaN(n) && isFinite(n)) out.copilotLicenseCount = String(Math.round(n));
  }

  return out;
}

// ── PowerShell property-bag parser ───────────────────────────────────────────

/**
 * Parse PowerShell property-bag output, e.g.:
 *   tenantDomain  : mccawsoft.com
 *   usesTeams     : True
 *   licenseSKUs   : {ENTERPRISEPACK, FLOW_FREE}
 *   teamCount     : 18
 *
 * Returns null if fewer than 3 key:value pairs are found (probably not PS output).
 */
function parsePowerShellPropertyBag(text: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  let found = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Match "identifierChars : rest" — the key must start with a letter
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!m) continue;

    const key = m[1];
    const val = m[2].trim();

    // PS array literal: {item1, item2, ...}
    if (val.startsWith("{") && val.endsWith("}")) {
      const inner = val.slice(1, -1).trim();
      result[key] = inner
        ? inner.split(",").map(s => s.trim()).filter(Boolean)
        : [];
      found++;
      continue;
    }

    // Boolean literals
    if (val === "True")  { result[key] = true;  found++; continue; }
    if (val === "False") { result[key] = false; found++; continue; }

    // Numeric
    const num = Number(val);
    if (val !== "" && !isNaN(num) && isFinite(num)) {
      result[key] = num;
      found++;
      continue;
    }

    // String fallthrough
    result[key] = val;
    found++;
  }

  return found >= 3 ? result : null;
}

// ── Core entry point ──────────────────────────────────────────────────────────

/**
 * Parse M365 discovery script output (string or pre-parsed object) and return
 * a deterministic profile update map. Fields present in the output are extracted
 * directly — no AI inference involved.
 *
 * Handles:
 *  1. JSON string / pre-parsed JSON object
 *  2. JSON object embedded somewhere inside a larger string
 *  3. PowerShell property-bag output (key : value, True/False, {a, b} arrays)
 *
 * Returns an empty object if no recognisable fields are found.
 */
export function parseM365ScriptOutput(rawOutput: unknown): Record<string, unknown> {
  let data: Record<string, unknown>;

  if (typeof rawOutput === "string") {
    const text = rawOutput.trim();

    // 1. Try the whole string as JSON
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      } else {
        return {};
      }
    } catch {
      // 2. Try to extract the first balanced JSON object from the text.
      //    Use a stricter pattern (must start with `{"`) to avoid matching
      //    PowerShell array literals like {ENTERPRISEPACK, FLOW_FREE}.
      const jsonMatch = text.match(/\{"[\s\S]*\}/);
      let parsedFromJson: Record<string, unknown> | null = null;
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            parsedFromJson = parsed as Record<string, unknown>;
          }
        } catch {
          // not valid JSON — fall through to PowerShell parser
        }
      }

      if (parsedFromJson) {
        data = parsedFromJson;
      } else {
        // 3. Try PowerShell property-bag format
        const psData = parsePowerShellPropertyBag(text);
        if (!psData) return {};
        data = psData;
      }
    }
  } else if (typeof rawOutput === "object" && rawOutput !== null && !Array.isArray(rawOutput)) {
    data = rawOutput as Record<string, unknown>;
  } else {
    return {};
  }

  // Unwrap common wrapper keys (JSON convention: { data: {...} } etc.)
  const inner =
    (data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : null) ??
    (data.result && typeof data.result === "object" && !Array.isArray(data.result) ? data.result : null) ??
    (data.output && typeof data.output === "object" && !Array.isArray(data.output) ? data.output : null);

  return extractFields(inner ? inner as Record<string, unknown> : data);
}

/**
 * Normalise a profile update map for backward compatibility.
 * Converts the legacy `authMethod` (single string) into `authMethods` (array).
 */
export function normaliseProfileUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const out = { ...updates };
  const legacyAuth = out.authMethod;
  if (typeof legacyAuth === "string" && legacyAuth.trim()) {
    if (!Array.isArray(out.authMethods) || (out.authMethods as unknown[]).length === 0) {
      out.authMethods = [normaliseAuthMethod(legacyAuth)];
    }
    delete out.authMethod;
  }
  return out;
}
