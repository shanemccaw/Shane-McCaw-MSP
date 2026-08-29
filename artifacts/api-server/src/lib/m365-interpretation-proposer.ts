/**
 * m365-interpretation-proposer.ts (Git #1532, part of #1494)
 *
 * The "AI proposes" half of the Microsoft Changes interpretation layer's
 * authoring model. Shane authors, the AI proposes: this reads a roadmap item's
 * description or a Message Center post's `bodyContent` and returns the STRUCTURED
 * reading — change class, what it touches, who acts, controllability + how, and
 * the probe — for Shane to review and confirm.
 *
 * Nothing here writes to the database and nothing here is tenant-facing. A
 * proposal is always `status = 'proposed'` until a human confirms it (#1532's
 * named risk: an LLM confidently inventing an opt-out procedure that does not
 * exist). The route persists the proposal as unverified; only the explicit
 * confirm step promotes it.
 *
 * The prompt is deliberately strict: the model is told to answer "unknown" for
 * controllability and to leave `controlMethod` empty rather than invent an
 * opt-out it cannot cite — the whole point of the human-confirm gate is that an
 * invented procedure is caught, but the prompt should not manufacture them in the
 * first place.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger.ts";
import type {
  M365ChangeClass,
  M365Actor,
  M365Controllability,
  M365Touches,
  M365Probe,
} from "@workspace/db";

const log = logger.child({ channel: "integration.azure" });

// The model that reads the prose. A proposal is reviewed by a human before it can
// ever reach a tenant, so accuracy of the reading matters more than latency —
// Sonnet reads Microsoft's dense change prose materially better than Haiku.
const PROPOSER_MODEL = "claude-sonnet-5";

const CHANGE_CLASSES: M365ChangeClass[] = [
  "retirement",
  "default_flip",
  "new_feature",
  "breaking_change",
  "licensing",
];
const ACTORS: M365Actor[] = ["microsoft", "admin"];
const CONTROLLABILITY: M365Controllability[] = ["yes", "no", "unknown"];

export interface ProposerInput {
  /** The change's title (roadmap item title / Message Center post title). */
  title: string;
  /** The prose to read — roadmap `description` or Message Center `bodyContent` (HTML tolerated). */
  bodyContent: string;
  /** Extra structured hints Microsoft already gave us, folded into the prompt as context. */
  context?: {
    products?: string[];
    services?: string[];
    tags?: string[];
    status?: string | null;
  };
}

export interface InterpretationProposal {
  summary: string;
  changeClass: M365ChangeClass;
  touches: M365Touches;
  whoActs: M365Actor;
  controllable: M365Controllability;
  controlMethod: string | null;
  probe: M365Probe;
  /** Why the model read it this way — shown to Shane at confirm time. */
  rationale: string;
  /** The model that produced this reading, for provenance on the saved row. */
  model: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function buildPrompt(input: ProposerInput): string {
  const ctx = input.context ?? {};
  const known: string[] = [];
  if (ctx.products?.length) known.push(`Products: ${ctx.products.join(", ")}`);
  if (ctx.services?.length) known.push(`Services: ${ctx.services.join(", ")}`);
  if (ctx.tags?.length) known.push(`Tags: ${ctx.tags.join(", ")}`);
  if (ctx.status) known.push(`Status: ${ctx.status}`);

  return `You read Microsoft 365 change announcements (roadmap items and Message Center posts) and produce a STRUCTURED interpretation for an MSP. This interpretation is authored once and applies to every tenant, so read the CLASS of change — not any one tenant's estate.

TITLE:
${input.title}

${known.length ? `WHAT MICROSOFT ALREADY TAGGED:\n${known.join("\n")}\n` : ""}BODY:
${stripHtml(input.bodyContent).slice(0, 8000)}

Return ONLY a JSON object (no markdown fences, no preamble) with exactly these fields:

{
  "summary": string,            // one or two plain-language sentences: what is actually changing
  "changeClass": one of ${JSON.stringify(CHANGE_CLASSES)},
  "touches": {                  // what the change touches. Any list may be empty. Do NOT invent items.
    "services": string[],       // M365 service names (e.g. "Exchange Online", "Purview")
    "protocols": string[],      // low-level protocols (e.g. "EWS", "Basic Authentication")
    "skus": string[],           // license SKUs the change bears on (e.g. "Project Online", "Microsoft 365 E5")
    "settings": string[]        // tenant/admin settings the change flips (e.g. "External sharing")
  },
  "whoActs": one of ${JSON.stringify(ACTORS)},   // does Microsoft act automatically, or must an admin act?
  "controllable": one of ${JSON.stringify(CONTROLLABILITY)}, // can it be turned off / opted out of?
  "controlMethod": string | null,  // HOW to turn it off. ONLY if the body states it. Otherwise null. NEVER invent an opt-out.
  "probe": {                    // the bridge to per-tenant resolution: WHAT TO COUNT in a tenant to know if this applies
    "description": string,      // plain language, e.g. "mailboxes with EWS enabled"
    "graphEndpoint": string | null  // a Graph endpoint that could count it, if one obviously applies; else null
  },
  "rationale": string           // 1-3 sentences: why you classified it this way, and what you were unsure about
}

Rules:
- If you cannot tell whether it is controllable, answer "unknown" and set controlMethod to null. Do NOT guess an opt-out procedure — a fabricated opt-out is the single worst failure here.
- If Microsoft acts automatically with no admin action, set whoActs = "microsoft".
- The probe must describe a COUNTABLE thing in a tenant, not a yes/no. If nothing is countable, say so plainly in description and leave graphEndpoint null.
- Output ONLY the JSON object.`;
}

/**
 * Run the model against a source and return the proposed structured reading.
 * Throws on an empty/invalid model response so the route can surface an honest
 * error rather than persisting a fabricated proposal.
 */
export async function proposeInterpretation(input: ProposerInput): Promise<InterpretationProposal> {
  const prompt = buildPrompt(input);

  const message = await anthropic.messages.create({
    model: PROPOSER_MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI proposer returned no text response");
  }
  const raw = textBlock.text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.warn({ raw: raw.slice(0, 300) }, "m365-interpretation-proposer: response contained no parseable JSON");
    throw new Error("AI proposer response could not be parsed as JSON");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch (err) {
    log.warn({ err, raw: raw.slice(0, 300) }, "m365-interpretation-proposer: JSON.parse failed");
    throw new Error("AI proposer response was not valid JSON");
  }

  const changeClass = CHANGE_CLASSES.includes(parsed.changeClass as M365ChangeClass)
    ? (parsed.changeClass as M365ChangeClass)
    : "new_feature";
  const whoActs = ACTORS.includes(parsed.whoActs as M365Actor) ? (parsed.whoActs as M365Actor) : "microsoft";
  const controllable = CONTROLLABILITY.includes(parsed.controllable as M365Controllability)
    ? (parsed.controllable as M365Controllability)
    : "unknown";

  const touchesRaw = (parsed.touches ?? {}) as Record<string, unknown>;
  const touches: M365Touches = {
    services: coerceStringArray(touchesRaw.services),
    protocols: coerceStringArray(touchesRaw.protocols),
    skus: coerceStringArray(touchesRaw.skus),
    settings: coerceStringArray(touchesRaw.settings),
  };

  const probeRaw = (parsed.probe ?? {}) as Record<string, unknown>;
  const probe: M365Probe = {
    description: typeof probeRaw.description === "string" ? probeRaw.description : "",
    graphEndpoint: typeof probeRaw.graphEndpoint === "string" && probeRaw.graphEndpoint.trim() ? probeRaw.graphEndpoint.trim() : null,
    monitorCheckKey: null,
    powershell: null,
  };

  // Controllability guard: an opt-out method is only meaningful when the model
  // actually said it is controllable. If it hedged to "no"/"unknown", drop any
  // method it volunteered — this is the belt-and-braces to the prompt rule.
  const controlMethod =
    controllable === "yes" && typeof parsed.controlMethod === "string" && parsed.controlMethod.trim()
      ? parsed.controlMethod.trim()
      : null;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    changeClass,
    touches,
    whoActs,
    controllable,
    controlMethod,
    probe,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : "",
    model: message.model || PROPOSER_MODEL,
  };
}
