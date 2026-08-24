import { describe, it, expect } from "vitest";
import {
  resolveServiceExecutable,
  resolvePackKeyForService,
  MICROREM_TEMPLATE_BY_SLUG,
  PACK_KEY_BY_SERVICE_SLUG,
} from "./remediation-catalog";

describe("remediation-catalog wiring (Git #1172)", () => {
  it("resolves the five Quick-Start Write Packs from type_attributes.packKey (data-first)", () => {
    const r = resolveServiceExecutable({
      slug: "entra-id-quickstart-v1",
      category: "config_pack",
      typeAttributes: { packKey: "quickstart-v1" },
    });
    expect(r).toEqual({ kind: "config_pack", packKey: "quickstart-v1" });
  });

  it("falls back to the static pack map when type_attributes lacks packKey", () => {
    for (const [slug, packKey] of Object.entries(PACK_KEY_BY_SERVICE_SLUG)) {
      const r = resolveServiceExecutable({ slug, category: "config_pack", typeAttributes: null });
      expect(r).toEqual({ kind: "config_pack", packKey });
    }
  });

  it("prefers a persisted type_attributes.packKey over the fallback map", () => {
    const r = resolveServiceExecutable({
      slug: "entra-id-quickstart-v1",
      category: "config_pack",
      typeAttributes: { packKey: "some-other-pack-v2" },
    });
    expect(r).toEqual({ kind: "config_pack", packKey: "some-other-pack-v2" });
  });

  it("maps the twelve wired micro-remediations to their microrem.* template", () => {
    const wired = Object.entries(MICROREM_TEMPLATE_BY_SLUG).filter(([, t]) => t !== null);
    expect(wired).toHaveLength(12);
    for (const [slug, templateId] of wired) {
      const r = resolveServiceExecutable({ slug, category: "micro_remediation", typeAttributes: null });
      expect(r).toEqual({ kind: "micro_remediation", templateId });
    }
  });

  it("maps the irregular-named micro-remediations correctly (not a naming rule)", () => {
    expect(MICROREM_TEMPLATE_BY_SLUG["remediate-enable-ca-policy"]).toBe("microrem.enforce-ca-policy");
    expect(MICROREM_TEMPLATE_BY_SLUG["remediate-revoke-sessions"]).toBe("microrem.revoke-sign-in-sessions");
    expect(MICROREM_TEMPLATE_BY_SLUG["remediate-remove-waste-license"]).toBe("microrem.remove-unused-license");
    expect(MICROREM_TEMPLATE_BY_SLUG["remediate-device-compliance-gap"]).toBe("microrem.remediate-device-compliance");
  });

  it("returns kind:unwired (never fabricates) for the two products with no executable", () => {
    for (const slug of ["remediate-increase-storage-quota", "remediate-release-quarantine"]) {
      const r = resolveServiceExecutable({ slug, category: "micro_remediation", typeAttributes: null });
      expect(r.kind).toBe("unwired");
    }
  });

  it("prefers a persisted type_attributes.templateId over the static micro-rem map", () => {
    const r = resolveServiceExecutable({
      slug: "remediate-force-password-reset",
      category: "micro_remediation",
      typeAttributes: { templateId: "microrem.custom-override" },
    });
    expect(r).toEqual({ kind: "micro_remediation", templateId: "microrem.custom-override" });
  });

  it("covers exactly the fourteen catalog micro-remediations", () => {
    expect(Object.keys(MICROREM_TEMPLATE_BY_SLUG)).toHaveLength(14);
  });

  it("classifies an unrelated service as not_in_catalog", () => {
    const r = resolveServiceExecutable({ slug: "mfa-passwordless-rollout", category: "project", typeAttributes: null });
    expect(r).toEqual({ kind: "not_in_catalog" });
  });

  it("resolvePackKeyForService returns undefined for a non-pack service", () => {
    expect(resolvePackKeyForService({ slug: "remediate-revoke-sessions", category: "micro_remediation" })).toBeUndefined();
  });
});
