/**
 * shanebot-persona.test.ts
 *
 * The persona copy itself is DRAFT and will change — these tests deliberately
 * assert STRUCTURE and INVARIANTS, not wording, so Shane can rewrite every line
 * in shanebot-persona.ts without a single test turning red.
 *
 * The invariants that DO matter:
 *   - both surfaces render a complete voice block (no empty sections)
 *   - the shared core actually reaches both surfaces
 *   - the rendered prompt carries no grounding, guardrail, or control-token
 *     content — the persona module owns voice and nothing else (#361)
 */

import { describe, it, expect } from "vitest";
import {
  SHANEBOT_PERSONA_PORTAL,
  SHANEBOT_PERSONA_PUBLIC,
  getShaneBotPersona,
  personaGreeting,
  renderPersonaPrompt,
  type ShaneBotPersona,
} from "./shanebot-persona.ts";

const SURFACES: [string, ShaneBotPersona][] = [
  ["portal", SHANEBOT_PERSONA_PORTAL],
  ["public", SHANEBOT_PERSONA_PUBLIC],
];

describe("persona structure", () => {
  it.each(SURFACES)("%s persona has every field populated", (_label, persona) => {
    expect(persona.identity.name).toBeTruthy();
    expect(persona.identity.role).toBeTruthy();
    expect(persona.identity.speaksFor).toBeTruthy();
    expect(persona.identity.isNotShane).toBeTruthy();
    expect(persona.tone.voice.length).toBeGreaterThan(0);
    expect(persona.tone.register).toBeTruthy();
    expect(persona.tone.formatting.length).toBeGreaterThan(0);
    expect(persona.dos.length).toBeGreaterThan(0);
    expect(persona.donts.length).toBeGreaterThan(0);
    expect(persona.sampleOpeners.length).toBeGreaterThan(0);
  });

  it("resolves each surface to its own persona", () => {
    expect(getShaneBotPersona("portal")).toBe(SHANEBOT_PERSONA_PORTAL);
    expect(getShaneBotPersona("public")).toBe(SHANEBOT_PERSONA_PUBLIC);
    expect(SHANEBOT_PERSONA_PORTAL.surface).toBe("portal");
    expect(SHANEBOT_PERSONA_PUBLIC.surface).toBe("public");
  });

  it("shares a single core across both surfaces — an edit to it lands on both bots", () => {
    expect(SHANEBOT_PERSONA_PUBLIC.identity.name).toBe(SHANEBOT_PERSONA_PORTAL.identity.name);
    expect(SHANEBOT_PERSONA_PUBLIC.identity.speaksFor).toBe(SHANEBOT_PERSONA_PORTAL.identity.speaksFor);
    expect(SHANEBOT_PERSONA_PUBLIC.identity.isNotShane).toBe(SHANEBOT_PERSONA_PORTAL.identity.isNotShane);
    expect(SHANEBOT_PERSONA_PUBLIC.tone.voice).toEqual(SHANEBOT_PERSONA_PORTAL.tone.voice);

    // ...while each still adds its own surface-specific guidance on top.
    expect(SHANEBOT_PERSONA_PUBLIC.dos.length).toBeGreaterThan(0);
    expect(SHANEBOT_PERSONA_PUBLIC.donts).not.toEqual(SHANEBOT_PERSONA_PORTAL.donts);
    expect(SHANEBOT_PERSONA_PUBLIC.tone.register).not.toBe(SHANEBOT_PERSONA_PORTAL.tone.register);
  });

  it("greets from the persona's own first sample opener", () => {
    expect(personaGreeting("public")).toBe(SHANEBOT_PERSONA_PUBLIC.sampleOpeners[0]);
    expect(personaGreeting("portal")).toBe(SHANEBOT_PERSONA_PORTAL.sampleOpeners[0]);
  });
});

describe("renderPersonaPrompt", () => {
  it.each(SURFACES)("%s renders every section with its content", (_label, persona) => {
    const prompt = renderPersonaPrompt(persona);
    for (const heading of ["WHO YOU ARE", "HOW YOU SOUND", "FORMAT", "DO", "DON'T"]) {
      expect(prompt).toContain(heading);
    }
    expect(prompt).toContain(persona.identity.name);
    expect(prompt).toContain(persona.tone.register);
    for (const item of [...persona.tone.voice, ...persona.tone.formatting, ...persona.dos, ...persona.donts]) {
      expect(prompt).toContain(item);
    }
    for (const opener of persona.sampleOpeners) {
      expect(prompt).toContain(opener);
    }
  });

  it.each(SURFACES)("%s carries voice ONLY — no grounding, guardrail, or control tokens", (_label, persona) => {
    const prompt = renderPersonaPrompt(persona);
    // These belong to the routes/guardrail, not to the voice file. If one shows
    // up here, safety or grounding logic has leaked into the persona module.
    for (const foreign of [
      "ESCALATE_TO_HUMAN",
      "FLAG_FOR_REVIEW",
      "PROPOSE_REMEDIATION",
      "SUGGESTED_REPLIES",
      "SERVICES CATALOG",
      "PLATFORM DATA",
      "HARD BOUNDARY",
    ]) {
      expect(prompt).not.toContain(foreign);
    }
  });

  it("never lets ShaneBot claim to be Shane himself", () => {
    for (const [, persona] of SURFACES) {
      expect(renderPersonaPrompt(persona)).toContain(persona.identity.isNotShane);
      expect(persona.identity.isNotShane).toMatch(/not shane/i);
    }
  });
});
