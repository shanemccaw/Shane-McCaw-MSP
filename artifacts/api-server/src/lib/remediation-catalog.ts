/**
 * remediation-catalog.ts
 *
 * The single source of truth wiring a CATALOG PRODUCT (a `services` row a
 * customer buys) to the REAL EXECUTABLE that fulfils it:
 *
 *   - a Config Pack (Quick-Start Write Pack)  → a `config_packs.pack_key`
 *   - a micro-remediation                     → a `baseline_action_templates.template_id`
 *
 * Background (Git #1172): the executable universe (config_packs / config_pack_
 * templates / baseline_action_templates incl. the `microrem.*` family) and the
 * sellable catalog (`services`, category 'config_pack' / 'micro_remediation')
 * were seeded independently and never wired together. The only prior link was a
 * single hard-coded entry (INSTANT_PACK_BY_SERVICE_SLUG in
 * portal-mission-control.ts, "entra-id-quickstart-v1" → "quickstart-v1"). This
 * module formalises the full mapping so both the customer-facing instant-
 * remediation path and the admin testbed testing surface resolve a product to
 * its executable the same way.
 *
 * WHY A STATIC MAP FOR MICRO-REMEDIATIONS: the service slug → template id
 * relationship is NOT a derivable naming rule (e.g. `remediate-enable-ca-policy`
 * → `microrem.enforce-ca-policy`, `remediate-revoke-sessions` →
 * `microrem.revoke-sign-in-sessions`, `remediate-remove-waste-license` →
 * `microrem.remove-unused-license`). It must be declared. Packs, by contrast,
 * already carry their link in the data (`services.type_attributes.packKey`), so
 * pack resolution is data-driven and this file only holds a fallback for it.
 *
 * Two of the fourteen micro-remediation products have NO executable template at
 * all today and are mapped to `null` on purpose — an honest gap, not a guess:
 *   - remediate-increase-storage-quota (SharePoint site quota is CSOM, not Graph)
 *   - remediate-release-quarantine     (no Exchange Online quarantine template exists yet)
 * Resolving these returns kind:"unwired" so a caller never fabricates a run.
 */

/** A catalog service resolved to the concrete thing that executes it. */
export type ResolvedExecutable =
  | { kind: "config_pack"; packKey: string }
  | { kind: "micro_remediation"; templateId: string }
  /** A catalog product that intentionally has no executable yet (declared gap). */
  | { kind: "unwired"; reason: string }
  /** A service not covered by this catalog (not a pack or micro-remediation). */
  | { kind: "not_in_catalog" };

/**
 * micro-remediation `services.slug` → `baseline_action_templates.template_id`.
 * `null` = a product that has no executable template yet (see file header).
 * This is the authoritative declaration; the runtime prefers a persisted
 * `type_attributes.templateId` if present and falls back to this.
 */
export const MICROREM_TEMPLATE_BY_SLUG: Record<string, string | null> = {
  "remediate-block-file-hash": "microrem.block-file-hash",
  "remediate-deactivate-ownerless-team": "microrem.deactivate-ownerless-team",
  "remediate-enable-mailbox-archive": "microrem.enable-mailbox-archive",
  "remediate-enable-ca-policy": "microrem.enforce-ca-policy",
  "remediate-force-password-reset": "microrem.force-password-reset",
  "remediate-increase-storage-quota": null, // SharePoint site quota (CSOM), no Graph template
  "remediate-isolate-device": "microrem.isolate-device",
  "remediate-release-quarantine": null, // no Exchange Online quarantine-release template yet
  "remediate-device-compliance-gap": "microrem.remediate-device-compliance",
  "remediate-remove-sharing-link": "microrem.remove-sharing-link",
  "remediate-remove-risky-app-consent": "microrem.remove-risky-app-consent",
  "remediate-remove-stale-group-member": "microrem.remove-stale-group-member",
  "remediate-remove-waste-license": "microrem.remove-unused-license",
  "remediate-revoke-sessions": "microrem.revoke-sign-in-sessions",
};

/**
 * Fallback Config Pack `services.slug` → `config_packs.pack_key`. The DB carries
 * this as `type_attributes.packKey`; this fallback only fires if that is
 * missing, so the runtime never depends on it. Kept so the mapping is auditable
 * in one place.
 *
 * The first five are the public Quick-Start Write Packs that are #1172's named
 * scope. The remaining eight are the other sellable config-pack products, wired
 * here for a complete testing surface (their slug → pack key is the regular
 * `<x>-pack-v1` → `<x>-v1` rule, but declared explicitly rather than derived
 * because Quick-Start itself breaks that rule).
 */
export const PACK_KEY_BY_SERVICE_SLUG: Record<string, string> = {
  // #1172 named Quick-Start Write Packs
  "entra-id-quickstart-v1": "quickstart-v1",
  "onboarding-pack-v1": "onboarding-v1",
  "offboarding-pack-v1": "offboarding-v1",
  "security-incident-response-pack-v1": "security-incident-response-v1",
  "compromised-account-recovery-pack-v1": "compromised-account-recovery-v1",
  // Other sellable config-pack products
  "baseline-licensing-pack-v1": "baseline-licensing-v1",
  "break-glass-access-pack-v1": "break-glass-access-v1",
  "conditional-access-baseline-pack-v1": "conditional-access-baseline-v1",
  "device-compliance-pack-v1": "device-compliance-v1",
  "email-security-pack-v1": "email-security-v1",
  "identity-hygiene-pack-v1": "identity-hygiene-v1",
  "mfa-enforcement-pack-v1": "mfa-enforcement-v1",
  "privileged-access-pack-v1": "privileged-access-v1",
  "sharepoint-oversharing-pack-v1": "sharepoint-oversharing-v1",
};

/** The minimal shape of a `services` row this resolver needs. */
export interface CatalogServiceRef {
  slug: string | null;
  category: string | null;
  /** `services.type_attributes` (jsonb) — packKey / templateId live here when persisted. */
  typeAttributes?: unknown;
}

function readStringAttr(typeAttributes: unknown, key: string): string | undefined {
  if (typeAttributes && typeof typeAttributes === "object") {
    const v = (typeAttributes as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Resolve which config pack a catalog service runs, data-first: prefer the
 * persisted `type_attributes.packKey`, then the static fallback map. Returns
 * `undefined` if this service maps to no pack.
 */
export function resolvePackKeyForService(service: CatalogServiceRef): string | undefined {
  const fromData = readStringAttr(service.typeAttributes, "packKey");
  if (fromData) return fromData;
  return service.slug ? PACK_KEY_BY_SERVICE_SLUG[service.slug] : undefined;
}

/**
 * Resolve a catalog service to the concrete executable that fulfils it. Prefers
 * persisted `type_attributes` values, then the declared static maps.
 */
export function resolveServiceExecutable(service: CatalogServiceRef): ResolvedExecutable {
  const slug = service.slug ?? "";

  // Config Pack products.
  if (service.category === "config_pack" || readStringAttr(service.typeAttributes, "packKey")) {
    const packKey = resolvePackKeyForService(service);
    return packKey
      ? { kind: "config_pack", packKey }
      : { kind: "unwired", reason: "config_pack service has no packKey in type_attributes or fallback map" };
  }

  // Micro-remediation products.
  if (service.category === "micro_remediation" || slug.startsWith("remediate-")) {
    const persisted = readStringAttr(service.typeAttributes, "templateId");
    if (persisted) return { kind: "micro_remediation", templateId: persisted };

    if (slug in MICROREM_TEMPLATE_BY_SLUG) {
      const templateId = MICROREM_TEMPLATE_BY_SLUG[slug];
      return templateId
        ? { kind: "micro_remediation", templateId }
        : { kind: "unwired", reason: "no executable template exists for this micro-remediation yet" };
    }
    return { kind: "unwired", reason: `micro-remediation slug '${slug}' is not declared in the wiring map` };
  }

  return { kind: "not_in_catalog" };
}
