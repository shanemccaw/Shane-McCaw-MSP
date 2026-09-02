/**
 * remediation-tracker-catalogue.test.ts — Git #733 (Phase D1 of Epic #647).
 *
 * `remediation-tracker-catalogue.ts` is a hand-duplicated copy of
 * msp-portal's real `previewRemediationGuide.ts` (api-server cannot import
 * across app boundaries). This reads that real file directly, the same
 * pattern `portal-remediation-tracker.test.ts` already uses to guard its own
 * id-only duplication, so a step renamed, reordered or reassigned to a
 * different pillar there fails here instead of silently going stale on every
 * export.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REMEDIATION_TRACKER_CATALOGUE } from "./remediation-tracker-catalogue";

describe("the export catalogue has not drifted from previewRemediationGuide.ts", () => {
  it("matches id, label, pillar and title for all 28 steps, in order", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const guidePath = path.resolve(
      // #1956 — corrected from a stale "../../../msp-portal/..." path (that
      // directory was retired in favor of artifacts/portal/, and this drift
      // guard had been silently ENOENT-ing rather than actually comparing).
      here,
      "../../../portal/src/components/copilot-journey/previewRemediationGuide.ts",
    );
    const source = readFileSync(guidePath, "utf8");

    const stepBlocks = [...source.matchAll(
      /^ {4}id: "(s\d+)",\r?\n {4}label: "(Step \d+)",\r?\n {4}pillar: "(\w+)",[\s\S]*?\r?\n {4}title: "((?:[^"\\]|\\.)*)",/gm,
    )].map((m) => ({
      id: m[1],
      label: m[2],
      pillar: m[3],
      title: m[4].replace(/\\"/g, '"'),
    }));

    // Guards the guard: if the regex ever stops matching the file's shape
    // this would silently pass on an empty list.
    expect(stepBlocks.length).toBeGreaterThan(0);
    expect(stepBlocks).toEqual(REMEDIATION_TRACKER_CATALOGUE.map((s) => ({
      id: s.id,
      label: s.label,
      pillar: s.pillar,
      title: s.title,
    })));
  });
});
