import { logger } from "./logger";
import { AZURE_BUILT_IN_ROLE_IDS, AZURE_RM_LEAST_PRIVILEGE_ROLE } from "./azure-rm";

const log = logger.child({ channel: "integration.azure" });

// ─────────────────────────────────────────────────────────────────────────────
// Azure Lighthouse onboarding — template/deep-link generation (#1915)
//
// This is the customer-facing onboarding mechanism azure-rm.ts's header
// documents but does not itself generate: an ARM template that DELEGATES a
// built-in Azure role, at a scope the customer chooses, to this platform's own
// tenant, per Microsoft's published mechanism —
// https://learn.microsoft.com/en-us/azure/lighthouse/how-to/onboard-customer.
//
// WHAT THIS MODULE DOES NOT DO: apply anything. It only generates the template
// content and the deploy-link the customer would use to deploy it THEMSELVES,
// in THEIR OWN tenant, via the Azure Portal — the same one-way mechanism
// azure-rm.ts's header describes ("the managing tenant never needs
// Microsoft.Authorization/roleAssignments/write in the customer's directory").
// No ARM write call is made from this platform at any point.
//
// WHO gets delegated: Lighthouse authorizations name a principal (user, group,
// or service principal object id) IN THE MANAGING TENANT — i.e. THIS platform's
// own home Entra tenant, not the customer's. That is a genuinely different value
// from `armPrincipalCredentials().clientId` (azure-rm.ts), which is a client id
// valid across every tenant a multi-tenant app is consented into; Lighthouse
// needs the service principal's OBJECT id specifically in the managing tenant.
// That value is real one-time configuration only Shane can supply (looked up in
// his own tenant's Entra ID), so it is read from env rather than invented here —
// same discipline `armPrincipalCredentials()` already uses for missing ARM
// creds: report the gap honestly, never fabricate a value.
// ─────────────────────────────────────────────────────────────────────────────

export interface LighthouseManagingTenantConfig {
  /** This platform's own Entra tenant GUID — the tenant Lighthouse delegates INTO. */
  managingTenantId: string;
  /** The object id (in the managing tenant) of the user/group/service principal being delegated the role. */
  principalId: string;
  /** Friendly label Azure Portal shows for the authorization — e.g. "Shane McCaw Consulting — Platform ARM Reader". */
  principalDisplayName: string;
}

/**
 * Reads the managing-tenant identity from env. Returns null (never throws) when
 * any piece is missing — the same "absence is a real signal, not an error"
 * pattern `armPrincipalCredentials()` uses, so callers can report the gap
 * honestly instead of half-generating a broken template.
 */
export function lighthouseManagingTenantConfig(): LighthouseManagingTenantConfig | null {
  // Falls back to GRAPH_TENANT_ID: that value is already this platform's real
  // home/testbed Entra tenant GUID (mccawsoft2.onmicrosoft.com — see CLAUDE.md's
  // "app registration is the boundary, not the tenant"), so there is no reason
  // to make Shane re-enter the same GUID under a second name.
  const managingTenantId = process.env.AZURE_LIGHTHOUSE_MANAGING_TENANT_ID || process.env.GRAPH_TENANT_ID;
  // No equivalent fallback exists for these two: the Lighthouse authorization's
  // principalId must be a specific object id (user/group/service principal) IN
  // that tenant, which is not derivable from anything already in env — it is a
  // one-time value only Shane can look up in his own tenant's Entra ID.
  const principalId = process.env.AZURE_LIGHTHOUSE_PRINCIPAL_ID;
  const principalDisplayName = process.env.AZURE_LIGHTHOUSE_PRINCIPAL_DISPLAY_NAME;
  if (!managingTenantId || !principalId || !principalDisplayName) return null;
  return { managingTenantId, principalId, principalDisplayName };
}

// ── Scope ─────────────────────────────────────────────────────────────────────

export type LighthouseScopeType = "subscription" | "resource_group";

export interface LighthouseScopeRequest {
  scopeType: LighthouseScopeType;
  subscriptionId: string;
  /** Required when scopeType = "resource_group"; ignored otherwise. */
  resourceGroupName?: string;
}

/** Per Microsoft's documented mechanism: a Lighthouse authorization is always issued at subscription scope, deployed either directly against the subscription or scoped down to one resource group within it. */
export function resolveArmScopePath(req: LighthouseScopeRequest): string {
  if (req.scopeType === "resource_group") {
    if (!req.resourceGroupName) {
      throw new Error("resourceGroupName is required when scopeType = 'resource_group'");
    }
    return `/subscriptions/${req.subscriptionId}/resourceGroups/${req.resourceGroupName}`;
  }
  return `/subscriptions/${req.subscriptionId}`;
}

// ── Template generation ──────────────────────────────────────────────────────

export interface LighthouseAuthorization {
  principalId: string;
  roleDefinitionId: string;
  principalIdDisplayName: string;
}

/**
 * The exact shape Microsoft documents for a Lighthouse onboarding template's
 * `authorizations` parameter and top-level resources
 * (learn.microsoft.com/azure/lighthouse/how-to/onboard-customer#full-template).
 * Kept as a plain object (not a class) — this is deployed by the CUSTOMER via
 * the Azure Portal or `az deployment sub create`, not executed by this platform.
 */
export interface LighthouseArmTemplate {
  $schema: string;
  contentVersion: string;
  parameters: {
    mspOfferName: { type: "string"; metadata: { description: string }; defaultValue: string };
    mspOfferDescription: { type: "string"; metadata: { description: string }; defaultValue: string };
    managedByTenantId: { type: "string"; metadata: { description: string }; defaultValue: string };
    authorizations: { type: "array"; metadata: { description: string }; defaultValue: LighthouseAuthorization[] };
  };
  variables: Record<string, unknown>;
  resources: Record<string, unknown>[];
  outputs: Record<string, unknown>;
}

export interface BuildLighthouseTemplateOptions {
  mspOfferName: string;
  mspOfferDescription: string;
  scope: LighthouseScopeRequest;
  /** Defaults to AZURE_RM_LEAST_PRIVILEGE_ROLE (Reader) / AZURE_BUILT_IN_ROLE_IDS.Reader — the transport this exists to onboard is read-only by construction (azure-rm.ts). */
  roleDefinitionId?: string;
  roleName?: string;
}

export interface BuiltLighthouseOffer {
  armScopePath: string;
  roleDefinitionId: string;
  roleName: string;
  template: LighthouseArmTemplate;
  authorizations: LighthouseAuthorization[];
}

/**
 * Builds the real Lighthouse ARM template content for one offer. Deterministic
 * and side-effect-free — callers persist the result (tenant_azure_lighthouse_offers)
 * and/or serve it to a customer; this function itself does nothing but generate.
 *
 * Throws when the managing-tenant identity isn't configured (see
 * lighthouseManagingTenantConfig) — an unconfigured platform cannot honestly
 * generate a delegation target, and a half-built template naming an empty
 * principal id would silently fail the customer's deployment instead of failing
 * here where the cause is legible.
 */
export function buildLighthouseArmTemplate(opts: BuildLighthouseTemplateOptions): BuiltLighthouseOffer {
  const config = lighthouseManagingTenantConfig();
  if (!config) {
    throw new Error(
      "Azure Lighthouse managing-tenant identity is not configured — set " +
      "AZURE_LIGHTHOUSE_MANAGING_TENANT_ID, AZURE_LIGHTHOUSE_PRINCIPAL_ID and " +
      "AZURE_LIGHTHOUSE_PRINCIPAL_DISPLAY_NAME (the object id, in this platform's own " +
      "home Entra tenant, of the principal that should receive the delegated role)",
    );
  }

  const roleDefinitionId = opts.roleDefinitionId ?? AZURE_BUILT_IN_ROLE_IDS.Reader;
  const roleName = opts.roleName ?? AZURE_RM_LEAST_PRIVILEGE_ROLE;
  const armScopePath = resolveArmScopePath(opts.scope);

  const authorizations: LighthouseAuthorization[] = [{
    principalId: config.principalId,
    roleDefinitionId,
    principalIdDisplayName: config.principalDisplayName,
  }];

  // Verbatim structure per Microsoft's documented mainTemplate.json
  // (learn.microsoft.com/azure/lighthouse/how-to/onboard-customer#full-template),
  // scoped to a subscription — Lighthouse authorizations are always issued at
  // subscription level even when the customer later deploys it scoped to one
  // resource group within that subscription.
  const template: LighthouseArmTemplate = {
    $schema: "https://schema.management.azure.com/schemas/2019-08-01/subscriptionDeploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    parameters: {
      mspOfferName: {
        type: "string",
        metadata: { description: "Name of the offer from the MSP" },
        defaultValue: opts.mspOfferName,
      },
      mspOfferDescription: {
        type: "string",
        metadata: { description: "Description of the MSP offer" },
        defaultValue: opts.mspOfferDescription,
      },
      managedByTenantId: {
        type: "string",
        metadata: { description: "Tenant id of the MSP" },
        defaultValue: config.managingTenantId,
      },
      authorizations: {
        type: "array",
        metadata: { description: "Array of role assignment authorizations for the MSP" },
        defaultValue: authorizations,
      },
    },
    variables: {},
    resources: [
      {
        type: "Microsoft.ManagedServices/registrationDefinitions",
        apiVersion: "2022-10-01",
        name: "[guid(parameters('mspOfferName'))]",
        properties: {
          registrationDefinitionName: "[parameters('mspOfferName')]",
          description: "[parameters('mspOfferDescription')]",
          managedByTenantId: "[parameters('managedByTenantId')]",
          authorizations: "[parameters('authorizations')]",
        },
      },
      {
        type: "Microsoft.ManagedServices/registrationAssignments",
        apiVersion: "2022-10-01",
        name: "[guid(parameters('mspOfferName'))]",
        dependsOn: [
          "[resourceId('Microsoft.ManagedServices/registrationDefinitions', guid(parameters('mspOfferName')))]",
        ],
        properties: {
          registrationDefinitionId:
            "[resourceId('Microsoft.ManagedServices/registrationDefinitions', guid(parameters('mspOfferName')))]",
        },
      },
    ],
    outputs: {
      mspOfferName: {
        type: "string",
        value: "[concat('Managed by ', parameters('mspOfferName'))]",
      },
      authorizations: {
        type: "array",
        value: "[parameters('authorizations')]",
      },
    },
  };

  log.info(
    { armScopePath, roleDefinitionId, managingTenantId: config.managingTenantId },
    "azure-lighthouse-onboarding: built ARM template for offer",
  );

  return { armScopePath, roleDefinitionId, roleName, template, authorizations };
}

/**
 * Azure Portal's documented "create from template URI" deep link
 * (aka.ms/deploytoazure is a redirector to this same URL shape). Requires the
 * template to be reachable at a public HTTPS URL Azure's portal can fetch —
 * this platform does not yet serve one (no UI consumer exists for this issue;
 * see #1915's own scope note and #1650), so `templateUri` is a caller-supplied
 * placeholder today. Kept as its own pure function rather than inlined so the
 * real link format is declared once, in code, for whichever route ends up
 * serving the template publicly.
 */
export function buildLighthouseDeepLink(templateUri: string): string {
  return `https://portal.azure.com/#create/Microsoft.Template/uri/${encodeURIComponent(templateUri)}`;
}
