/**
 * workflow-executor-resolve-steps.test.ts
 *
 * #3800 — unit tests for the resolve-then-write core: runTemplateResolveSteps()
 * and resolveProvidedVariablesOf(). These are the read-informs-the-next-write
 * half of the write-pack execution model — a filtered Graph GET whose selected
 * item's field(s) feed a subsequent write's payload (the mechanism KFM/ADMX
 * writes depend on).
 *
 * The core lives in ./resolve-then-write.ts, deliberately free of db/Graph
 * imports (same pattern as mfa-reregistration.ts), so these tests exercise real
 * matching/assignment/fail-closed logic against an injected graphGet fake with no
 * heavy module graph.
 */
import { describe, it, expect, vi } from "vitest";

import {
  runTemplateResolveSteps,
  resolveProvidedVariablesOf,
  type BaselineTemplateResolveStep,
} from "./resolve-then-write.ts";

describe("resolveProvidedVariablesOf", () => {
  it("returns the flat set of every step's assign var names", () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/a", assign: { defId: "id" } },
      { endpoint: "/b", assign: { presId: "id", label: "displayName" } },
    ];
    expect(resolveProvidedVariablesOf(steps).sort()).toEqual(["defId", "label", "presId"]);
  });

  it("is empty for null/empty", () => {
    expect(resolveProvidedVariablesOf(null)).toEqual([]);
    expect(resolveProvidedVariablesOf([])).toEqual([]);
  });
});

describe("runTemplateResolveSteps", () => {
  it("selects by exact match on a collection and assigns the extracted field", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/defs", selectMatch: { name: "KFM" }, assign: { defId: "id" } },
    ];
    const graphGet = vi.fn(async () => ({
      value: [
        { id: "wrong-1", name: "Other" },
        { id: "right-2", name: "KFM" },
      ],
    }));
    const out = await runTemplateResolveSteps(steps, {}, graphGet);
    expect(out.failed).toBe(false);
    expect(out.resolvedVars).toEqual({ defId: "right-2" });
    expect(graphGet).toHaveBeenCalledWith("/defs");
  });

  it("supports case-insensitive substring matching via contains:", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      {
        endpoint: "/defs",
        selectMatch: { displayName: "contains:silently move windows known folders" },
        assign: { defId: "id" },
      },
    ];
    const graphGet = async () => ({
      value: [
        { id: "wizard", displayName: "Prompt users to move Windows known folders to OneDrive" },
        { id: "silent", displayName: "Silently move Windows known folders to OneDrive" },
        { id: "block", displayName: "Prevent users from redirecting their Windows known folders to their PC" },
      ],
    });
    const out = await runTemplateResolveSteps(steps, {}, graphGet);
    expect(out.resolvedVars).toEqual({ defId: "silent" });
  });

  it("threads an earlier step's assignment into a later step's endpoint and match", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/defs?q={{q}}", selectMatch: { displayName: "contains:known folders" }, assign: { defId: "id" } },
      {
        endpoint: "/defs('{{defId}}')/presentations",
        selectMatch: { "@odata.type": "contains:groupPolicyPresentationTextBox" },
        assign: { presId: "id" },
      },
    ];
    const seen: string[] = [];
    const graphGet = async (endpoint: string) => {
      seen.push(endpoint);
      if (endpoint.includes("/presentations")) {
        return {
          value: [
            { id: "p-label", "@odata.type": "#microsoft.graph.groupPolicyPresentationText" },
            { id: "p-textbox", "@odata.type": "#microsoft.graph.groupPolicyPresentationTextBox" },
          ],
        };
      }
      return { value: [{ id: "def-xyz", displayName: "Silently move Windows known folders to OneDrive" }] };
    };
    const out = await runTemplateResolveSteps(steps, { q: "onedrive" }, graphGet);
    expect(out.failed).toBe(false);
    // {{q}} substituted from base payload; {{defId}} substituted from step 1's assignment.
    expect(seen[0]).toBe("/defs?q=onedrive");
    expect(seen[1]).toBe("/defs('def-xyz')/presentations");
    // contains:...TextBox must NOT pick the plain ...Text label presentation.
    expect(out.resolvedVars).toEqual({ defId: "def-xyz", presId: "p-textbox" });
  });

  it("treats a non-collection response as a single candidate", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/org", assign: { orgId: "id" } },
    ];
    const out = await runTemplateResolveSteps(steps, {}, async () => ({ id: "org-1", displayName: "Contoso" }));
    expect(out.resolvedVars).toEqual({ orgId: "org-1" });
  });

  it("fails closed (no partial write) when a required step matches nothing", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/defs", selectMatch: { displayName: "contains:nonexistent policy" }, assign: { defId: "id" } },
    ];
    const out = await runTemplateResolveSteps(steps, {}, async () => ({ value: [{ id: "x", displayName: "Other" }] }));
    expect(out.failed).toBe(true);
    expect(out.resolvedVars).toEqual({});
    expect(out.failedEndpoint).toBe("/defs");
    expect(out.reason).toContain("matched no item");
  });

  it("fails closed when a required step's read throws", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/beta/defs", assign: { defId: "id" } },
    ];
    const out = await runTemplateResolveSteps(steps, {}, async () => { throw new Error("GET /beta/defs failed (400)"); });
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("GET /beta/defs failed");
    expect(out.failedEndpoint).toBe("/beta/defs");
  });

  it("fails closed when the matched item lacks the field to assign", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/defs", assign: { defId: "id" } },
    ];
    const out = await runTemplateResolveSteps(steps, {}, async () => ({ value: [{ displayName: "no id here" }] }));
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("no 'id'");
  });

  it("an optional step that matches nothing is skipped without failing", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/defs", selectMatch: { name: "missing" }, assign: { opt: "id" }, optional: true },
      { endpoint: "/other", assign: { defId: "id" } },
    ];
    const out = await runTemplateResolveSteps(steps, {}, async (endpoint) =>
      endpoint === "/other" ? { value: [{ id: "ok" }] } : { value: [] },
    );
    expect(out.failed).toBe(false);
    expect(out.resolvedVars).toEqual({ defId: "ok" });
  });

  it("selects the first candidate unconditionally when no selectMatch is given", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/defs", assign: { defId: "id" } },
    ];
    const out = await runTemplateResolveSteps(steps, {}, async () => ({
      value: [{ id: "first" }, { id: "second" }],
    }));
    expect(out.resolvedVars).toEqual({ defId: "first" });
  });

  it("reads a nested dot-path field off the matched item", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      { endpoint: "/x", assign: { inner: "meta.inner" } },
    ];
    const out = await runTemplateResolveSteps(steps, {}, async () => ({ value: [{ meta: { inner: "deep" } }] }));
    expect(out.resolvedVars).toEqual({ inner: "deep" });
  });

  // #3959 — the Settings Catalog KFM resolve step: picks the PARENT choice setting
  // (empty rootDefinitionId) out of a filtered candidate set that also contains its
  // dropdown/textbox children, without needing to know or match on the exact
  // "onedrivengsc" vs "onedrivengscv2" category prefix Microsoft currently serves
  // two live variants of.
  it("resolves the KFM parent setting via an empty rootDefinitionId, regardless of the onedrivengsc/onedrivengscv2 category prefix", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      {
        endpoint: "https://graph.microsoft.com/beta/deviceManagement/configurationSettings?$filter=contains(id,'onedrivengsc_kfmoptinnowizard')",
        selectMatch: { rootDefinitionId: "" },
        assign: { kfmDefinitionId: "id" },
      },
    ];
    const v2Candidates = {
      value: [
        {
          id: "device_vendor_msft_policy_config_onedrivengscv2~policy~onedrivengsc_kfmoptinnowizard_kfmoptinnowizard_dropdown",
          rootDefinitionId: "device_vendor_msft_policy_config_onedrivengscv2~policy~onedrivengsc_kfmoptinnowizard",
        },
        {
          id: "device_vendor_msft_policy_config_onedrivengscv2~policy~onedrivengsc_kfmoptinnowizard_kfmoptinnowizard_textbox",
          rootDefinitionId: "device_vendor_msft_policy_config_onedrivengscv2~policy~onedrivengsc_kfmoptinnowizard",
        },
        {
          id: "device_vendor_msft_policy_config_onedrivengscv2~policy~onedrivengsc_kfmoptinnowizard",
          rootDefinitionId: "",
        },
      ],
    };
    const out = await runTemplateResolveSteps(steps, {}, async () => v2Candidates);
    expect(out.failed).toBe(false);
    expect(out.resolvedVars).toEqual({
      kfmDefinitionId: "device_vendor_msft_policy_config_onedrivengscv2~policy~onedrivengsc_kfmoptinnowizard",
    });
  });

  it("resolves the same way for the non-v2 category prefix", async () => {
    const steps: BaselineTemplateResolveStep[] = [
      {
        endpoint: "https://graph.microsoft.com/beta/deviceManagement/configurationSettings?$filter=contains(id,'onedrivengsc_kfmoptinnowizard')",
        selectMatch: { rootDefinitionId: "" },
        assign: { kfmDefinitionId: "id" },
      },
    ];
    const v1Candidates = {
      value: [
        {
          id: "device_vendor_msft_policy_config_onedrivengsc~policy~onedrivengsc_kfmoptinnowizard_kfmoptinnowizard_dropdown",
          rootDefinitionId: "device_vendor_msft_policy_config_onedrivengsc~policy~onedrivengsc_kfmoptinnowizard",
        },
        {
          id: "device_vendor_msft_policy_config_onedrivengsc~policy~onedrivengsc_kfmoptinnowizard",
          rootDefinitionId: "",
        },
      ],
    };
    const out = await runTemplateResolveSteps(steps, {}, async () => v1Candidates);
    expect(out.resolvedVars).toEqual({
      kfmDefinitionId: "device_vendor_msft_policy_config_onedrivengsc~policy~onedrivengsc_kfmoptinnowizard",
    });
  });
});
