/**
 * dev-fixtures.ts
 *
 * Synthetic M365 tenant payloads used by the dev seed endpoint.
 * These are NEVER imported in production code — only referenced by admin-dev-seed.ts
 * which is itself conditional on NODE_ENV !== 'production'.
 */

export interface M365TenantFixture {
  tenantDomain: string;
  orgName: string;
  activeUserPercent: number;
  securityGroupCount: number;
  licensedUserCount: number;
  sharepointSiteCount: number;
  teamCount: number;
  guestUserCount: number;
  conditionalAccessPoliciesCount: number;
  usesExchange: boolean;
  usesTeams: boolean;
  usesSharePoint: boolean;
  usesOneDrive: boolean;
  usesYammer: boolean;
  mfaEnforced: boolean;
  conditionalAccessEnabled: boolean;
  isMicrosoftPartner: boolean;
  allUsersLicensed: boolean;
  externalSharingEnabled: boolean;
  guestUsersPresent: boolean;
  isHybrid: boolean;
  hasOnPremExchange: boolean;
  usesAADConnect: boolean;
  intuneEnabled: boolean;
  hasAADP1orP2: boolean;
  hasDefender: boolean;
  hasDLP: boolean;
  usesComplianceCenter: boolean;
  sensitivityLabelsConfigured: boolean;
  hasRetentionPolicies: boolean;
  hasInsiderRisk: boolean;
  hasCopilotLicenses: boolean;
  copilotLicenseCount: string;
  licenseSKUs: string[];
  authMethods: string[];
}

/** Good tenant — MFA enforced, Defender on, CAP enabled, DLP on, high scores across all categories */
export const goodTenant: M365TenantFixture = {
  tenantDomain: "contoso.onmicrosoft.com",
  orgName: "Contoso Corp",
  activeUserPercent: 94,
  securityGroupCount: 48,
  licensedUserCount: 220,
  sharepointSiteCount: 65,
  teamCount: 38,
  guestUserCount: 12,
  conditionalAccessPoliciesCount: 14,
  usesExchange: true,
  usesTeams: true,
  usesSharePoint: true,
  usesOneDrive: true,
  usesYammer: false,
  mfaEnforced: true,
  conditionalAccessEnabled: true,
  isMicrosoftPartner: false,
  allUsersLicensed: true,
  externalSharingEnabled: false,
  guestUsersPresent: true,
  isHybrid: false,
  hasOnPremExchange: false,
  usesAADConnect: false,
  intuneEnabled: true,
  hasAADP1orP2: true,
  hasDefender: true,
  hasDLP: true,
  usesComplianceCenter: true,
  sensitivityLabelsConfigured: true,
  hasRetentionPolicies: true,
  hasInsiderRisk: false,
  hasCopilotLicenses: true,
  copilotLicenseCount: "40",
  licenseSKUs: ["M365 Business Premium", "Power BI Pro", "Microsoft Intune", "Entra ID P2"],
  authMethods: ["conditional_access", "mfa"],
};

/** Warning tenant — MFA ok, no Defender, no sensitivity labels, mixed scores */
export const warningTenant: M365TenantFixture = {
  tenantDomain: "fabrikam.onmicrosoft.com",
  orgName: "Fabrikam Industries",
  activeUserPercent: 71,
  securityGroupCount: 22,
  licensedUserCount: 110,
  sharepointSiteCount: 28,
  teamCount: 14,
  guestUserCount: 34,
  conditionalAccessPoliciesCount: 3,
  usesExchange: true,
  usesTeams: true,
  usesSharePoint: true,
  usesOneDrive: true,
  usesYammer: false,
  mfaEnforced: true,
  conditionalAccessEnabled: true,
  isMicrosoftPartner: false,
  allUsersLicensed: false,
  externalSharingEnabled: true,
  guestUsersPresent: true,
  isHybrid: true,
  hasOnPremExchange: true,
  usesAADConnect: true,
  intuneEnabled: false,
  hasAADP1orP2: true,
  hasDefender: false,
  hasDLP: false,
  usesComplianceCenter: false,
  sensitivityLabelsConfigured: false,
  hasRetentionPolicies: false,
  hasInsiderRisk: false,
  hasCopilotLicenses: false,
  copilotLicenseCount: "0",
  licenseSKUs: ["Office 365 E3", "Entra ID P1"],
  authMethods: ["mfa", "entra_id"],
};

/** Bad tenant — MFA off, no CAP, no DLP, critical-low scores across all categories */
export const badTenant: M365TenantFixture = {
  tenantDomain: "tailwind.onmicrosoft.com",
  orgName: "Tailwind Traders",
  activeUserPercent: 41,
  securityGroupCount: 6,
  licensedUserCount: 85,
  sharepointSiteCount: 9,
  teamCount: 4,
  guestUserCount: 67,
  conditionalAccessPoliciesCount: 0,
  usesExchange: true,
  usesTeams: false,
  usesSharePoint: false,
  usesOneDrive: false,
  usesYammer: false,
  mfaEnforced: false,
  conditionalAccessEnabled: false,
  isMicrosoftPartner: false,
  allUsersLicensed: false,
  externalSharingEnabled: true,
  guestUsersPresent: true,
  isHybrid: true,
  hasOnPremExchange: true,
  usesAADConnect: false,
  intuneEnabled: false,
  hasAADP1orP2: false,
  hasDefender: false,
  hasDLP: false,
  usesComplianceCenter: false,
  sensitivityLabelsConfigured: false,
  hasRetentionPolicies: false,
  hasInsiderRisk: false,
  hasCopilotLicenses: false,
  copilotLicenseCount: "0",
  licenseSKUs: ["Office 365 E1"],
  authMethods: ["password"],
};

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randBool(trueWeight = 0.5): boolean {
  return Math.random() < trueWeight;
}

function randFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a randomized M365 tenant fixture within realistic ranges */
export function generateRandomTenant(): M365TenantFixture {
  const mfaEnforced = randBool(0.6);
  const conditionalAccessEnabled = mfaEnforced ? randBool(0.7) : randBool(0.2);
  const hasAADP1orP2 = conditionalAccessEnabled || randBool(0.4);
  const hasDefender = randBool(0.55);
  const hasDLP = randBool(0.5);
  const hasCopilotLicenses = randBool(0.35);
  const intuneEnabled = hasDefender || randBool(0.3);
  const licensedUserCount = randInt(20, 500);
  const copilotCount = hasCopilotLicenses ? randInt(5, Math.floor(licensedUserCount * 0.4)) : 0;

  const skuPool = [
    "Office 365 E1", "Office 365 E3", "Office 365 E5",
    "M365 E3", "M365 E5", "M365 Business Premium", "M365 Business Standard",
    "M365 Business Basic",
  ];
  const extraSkuPool = [
    "Power BI Pro", "Microsoft Intune", "Entra ID P1", "Entra ID P2",
    "Defender for Office 365 P1", "Power Automate Free",
  ];
  const baseSkus = [randFrom(skuPool)];
  if (randBool(0.5)) baseSkus.push(randFrom(extraSkuPool));
  if (hasAADP1orP2 && !baseSkus.includes("Entra ID P1") && !baseSkus.includes("Entra ID P2")) {
    baseSkus.push(randBool(0.5) ? "Entra ID P1" : "Entra ID P2");
  }

  const authMethodPool = ["mfa", "conditional_access", "entra_id", "password", "sso_saml"];
  const primaryAuth = mfaEnforced ? "mfa" : randFrom(["password", "mfa", "entra_id"]);
  const authMethods = Array.from(new Set([primaryAuth, ...(conditionalAccessEnabled ? ["conditional_access"] : [])]));

  const domains = ["northwind", "adventure-works", "alpine", "proseware", "lucerne", "woodgrove"];
  const tenantDomain = `${randFrom(domains)}.onmicrosoft.com`;
  const orgNames: Record<string, string> = {
    "northwind": "Northwind Traders", "adventure-works": "Adventure Works",
    "alpine": "Alpine Ski House", "proseware": "Proseware Inc",
    "lucerne": "Lucerne Publishing", "woodgrove": "Woodgrove Bank",
  };
  const slug = tenantDomain.split(".")[0];
  const orgName = orgNames[slug] ?? "Sample Tenant";

  return {
    tenantDomain,
    orgName,
    activeUserPercent: randInt(35, 98),
    securityGroupCount: randInt(3, 80),
    licensedUserCount,
    sharepointSiteCount: randInt(2, 120),
    teamCount: randInt(1, 60),
    guestUserCount: randInt(0, Math.floor(licensedUserCount * 0.4)),
    conditionalAccessPoliciesCount: conditionalAccessEnabled ? randInt(1, 18) : 0,
    usesExchange: randBool(0.95),
    usesTeams: randBool(0.85),
    usesSharePoint: randBool(0.8),
    usesOneDrive: randBool(0.9),
    usesYammer: randBool(0.2),
    mfaEnforced,
    conditionalAccessEnabled,
    isMicrosoftPartner: randBool(0.1),
    allUsersLicensed: randBool(0.5),
    externalSharingEnabled: randBool(0.55),
    guestUsersPresent: randBool(0.6),
    isHybrid: randBool(0.3),
    hasOnPremExchange: randBool(0.25),
    usesAADConnect: randBool(0.3),
    intuneEnabled,
    hasAADP1orP2,
    hasDefender,
    hasDLP,
    usesComplianceCenter: hasDLP || randBool(0.35),
    sensitivityLabelsConfigured: hasDLP && randBool(0.7),
    hasRetentionPolicies: hasDLP && randBool(0.65),
    hasInsiderRisk: hasAADP1orP2 && randBool(0.25),
    hasCopilotLicenses,
    copilotLicenseCount: String(copilotCount),
    licenseSKUs: baseSkus,
    authMethods,
  };
}
