/**
 * warRoomBriefing.ts — #332 (War Room epic #302).
 *
 * The new scene that sits between the scan completing and the room's arrival
 * sequence: Shane introduces himself and explains how the next twenty minutes
 * work, and then the personas the conversation is about to be built around are
 * put in front of the customer one at a time to be confirmed or corrected.
 *
 * Sequence, after this lands:
 *   hero conversation → real scan → THIS SCENE → enterRoom() / startArrivals()
 *
 * ── What is real here and what is not ────────────────────────────────────────
 * REAL: the roster. Which personas get presented is the customer's own answer to
 * the hero quiz's persona step (`heroAnsIds.personas`, #308), resolved against
 * the same industry catalog the real Copilot assessment quiz asks from (#271 /
 * #306). Their names and descriptions are catalog rows, not invented roles.
 *
 * PLACEHOLDER: the profile written underneath each one — the "here is how I read
 * this role, and what Copilot changes for it" narrative. That is the part #302
 * says needs real AI generation from the quiz answers plus scan data, and real
 * generation is gated behind Shane's explicit go-ahead to spend tokens. So every
 * draft this module produces is built from the persona's OWN catalog description
 * and nothing else, carries `generated: false`, and is labelled as a placeholder
 * in the UI. Nothing here invents a seat count, a name, a system or a number —
 * swapping one fiction for another is the exact failure #306 was written to undo.
 *
 * `regenerate()` is therefore a real interaction against a stub: it advances to
 * the next placeholder phrasing so the loop is genuinely exercisable end to end,
 * and it is the single function a real Anthropic call replaces later.
 *
 * ── Two open questions, deliberately NOT decided here ────────────────────────
 * #302 and #332 both leave these open, and both are recorded rather than guessed:
 *
 * 1. When the customer describes a persona in their own words, does that text
 *    BECOME the persona's content, or become grounding for a further real
 *    generation attempt? `describe()` is written so neither answer is foreclosed:
 *    the customer's words are stored in their own field (`ownWords`) and the
 *    placeholder draft is kept intact alongside them. Whichever way Shane
 *    answers, the data the answer needs is already there — only the read changes.
 *
 * 2. How many reject → regenerate cycles before the flow needs a different
 *    resolution. `BRIEFING_MAX_REGENERATIONS` is one named constant, set to a
 *    working default, and the "different resolution" it opens is the one the
 *    issue already scopes: stop offering regeneration and ask the customer to
 *    describe the role themselves. No third path is invented.
 *
 * This file is typed and tested. The ported `WarRoomLogic` / `warRoomData` are
 * `@ts-nocheck` and stay that way; this is new logic, not ported design source.
 */
// Explicit .ts specifiers, matching warRoomScan.ts / warRoomSections.ts: it is
// what lets this module load under `node --test` as well as under Vite.
import type { ResolvedQuizCatalog } from "../copilot-assessment/quizCatalogClient.ts";

/**
 * How many times a customer can ask for a regeneration of the same persona
 * before the scene stops offering one.
 *
 * OPEN (#332): two is a working default, not Shane's answer. It is the number of
 * times a customer will watch the same role get rewritten before "the machine
 * cannot describe my business" is the honest read — but it is a judgement call,
 * and this constant is the only place it lives so changing it is a one-line
 * change with a test that names the behaviour rather than the number.
 */
export const BRIEFING_MAX_REGENERATIONS = 2;

/** The scene's two stages: Shane's tutorial, then the persona loop. */
export type BriefingStage = "intro" | "personas";

/** One card of Shane's opening tutorial. */
export interface BriefingBeat {
  readonly id: string;
  /** Small uppercase eyebrow above the card. */
  readonly tag: string;
  readonly title: string;
  /** Spoken paragraphs, in order. */
  readonly lines: readonly string[];
}

/**
 * Shane's introduction and the tutorial for how the room works.
 *
 * Real content: everything said here is true of what the platform actually does
 * — a read-only scan across the real check catalog, seven real pillars, a
 * findings register, and a statement of work at the end. It deliberately repeats
 * the read-only promise, because this is the last screen before the room starts
 * showing the customer their own tenant back to them.
 */
export const BRIEFING_BEATS: readonly BriefingBeat[] = [
  {
    id: "who",
    tag: "Before we go in",
    title: "So — properly, this time. I'm Shane.",
    lines: [
      "I've spent the last few years as the lead M365 architect on one of the largest Copilot programmes anyone has run, and the thing I learned there is the thing this whole room is built around.",
      "Copilot doesn't create exposure. It surfaces what already exists — instantly, with a citation. So the work isn't the rollout. The work is proving, before a single licence gets assigned, that it can't surface something it shouldn't.",
    ],
  },
  {
    id: "how",
    tag: "How this works",
    title: "You've done the talking. I've done the reading.",
    lines: [
      "The scan is finished. That was read-only — permissions, sharing, labels, licence assignment, device compliance, service health. I never read the contents of a document, only who can reach it.",
      "In a moment the room fills up. You'll meet the rest of the team, and we'll walk your tenant one pillar at a time: governance, licensing, adoption, compliance, health, and security last, because security is where it all lands.",
    ],
  },
  {
    id: "rules",
    tag: "Ground rules",
    title: "Interrupt me. That's the whole point of the room.",
    lines: [
      "Nothing here is a slide deck. Every number on the walls came out of your tenant in the last few minutes, and if one of them looks wrong, say so — it usually means the tenant is telling us something the check didn't expect.",
      "Nothing gets changed in your tenant today. Anything we decide to fix gets staged, costed, and written into a statement of work you leave with.",
    ],
  },
  {
    id: "personas",
    tag: "One last thing",
    title: "First, let's make sure I've got your people right.",
    lines: [
      "Everything after this is framed around the people who'd actually use Copilot here — the roles you picked out for me a minute ago.",
      "I'm going to show you how I've read each of them. Tell me where I'm wrong. A room built around the wrong people gives you the wrong answer, and I'd rather find that out now than in the statement of work.",
    ],
  },
];

/** Where a persona's profile text came from. */
export type BriefingPersonaSource = "placeholder" | "customer";

/** The narrative profile shown under a persona. */
export interface BriefingDraft {
  readonly headline: string;
  readonly dayToDay: string;
  readonly copilotFit: string;
  readonly watchFor: string;
  /**
   * Whether this text came out of a real model call. Always `false` in this
   * build — the field exists so the UI's "placeholder" badge is driven by the
   * data rather than by an assumption that will silently go stale the day real
   * generation is switched on.
   */
  readonly generated: boolean;
  /** Which placeholder phrasing this is; advanced by `regenerate()`. */
  readonly variant: number;
}

export type BriefingPersonaStatus = "pending" | "rejected" | "confirmed";

export interface BriefingPersona {
  readonly id: string;
  /** Real catalog title — the customer's own pick. */
  readonly name: string;
  /** Real catalog description of the role. */
  readonly role: string;
  readonly draft: BriefingDraft;
  readonly status: BriefingPersonaStatus;
  /** How many regenerations have been spent on this persona. */
  readonly regenerations: number;
  /** The customer's own description, verbatim. `''` until they give one. */
  readonly ownWords: string;
  readonly source: BriefingPersonaSource;
}

/**
 * The placeholder phrasings a draft cycles through.
 *
 * Each one is a frame — how I read the role / what the day looks like / where
 * Copilot lands — expressed only in terms of the persona's own real catalog
 * title and description. `role` is that description, dropped in verbatim; every
 * other word is generic by construction, because the specifics are precisely
 * what the real generation pass is for and inventing them here would put fiction
 * in front of a customer under Shane's name.
 */
const DRAFT_VARIANTS: ReadonlyArray<(name: string, role: string) => Omit<BriefingDraft, "generated" | "variant">> = [
  (name, role) => ({
    headline: `${name} — as I've read them so far`,
    dayToDay: role
      ? `From the catalog this role covers: ${role}`
      : `You picked ${name} out as one of the groups this tenant is really run by.`,
    copilotFit: `This is a role where Copilot earns its licence on the everyday work rather than the showpiece work — drafting, summarising, and finding the thing someone already wrote.`,
    watchFor: `The risk to watch for this role is reach: whatever they can already open, Copilot can already quote. That is what the findings register is about to show you.`,
  }),
  (name, role) => ({
    headline: `${name} — second read`,
    dayToDay: role
      ? `Reading it the other way round: ${role} — so the work is mostly other people's material, arriving faster than anyone can file it.`
      : `Reading it the other way round: ${name} spend their day inside other people's material.`,
    copilotFit: `For this role the win is retrieval before generation. Getting to the right document is worth more than writing a new one, and it is the half of Copilot that needs the least change management.`,
    watchFor: `Which makes oversharing the live issue rather than a theoretical one: retrieval is only safe if the permissions underneath it are.`,
  }),
  (name, role) => ({
    headline: `${name} — narrower read`,
    dayToDay: role
      ? `Taking the tightest version of it: ${role}. Fewer people, more sensitive material, and less tolerance for a wrong answer.`
      : `Taking the tightest version of ${name}: fewer people, more sensitive material, less tolerance for a wrong answer.`,
    copilotFit: `A role like that should be a later wave, not a pilot. The value is real, but it wants labelling and a scoped rollout in front of it.`,
    watchFor: `Treat this one as the reason to get governance right before the licences land, rather than as a reason to hold the whole programme.`,
  }),
];

/** Build the placeholder draft at a given variant index (wraps). */
export function briefingDraft(name: string, role: string, variant: number): BriefingDraft {
  const safe = ((variant % DRAFT_VARIANTS.length) + DRAFT_VARIANTS.length) % DRAFT_VARIANTS.length;
  return { ...DRAFT_VARIANTS[safe](name, role), generated: false, variant: safe };
}

/** How many distinct placeholder phrasings exist — exported so a test can't drift from the bank. */
export const BRIEFING_DRAFT_VARIANTS = DRAFT_VARIANTS.length;

/**
 * The personas this scene should present.
 *
 * `pickedIds` are the real catalog persona ids the customer ticked at the hero
 * quiz's persona step. If they picked none — a real state, since the step is
 * skippable — the scene falls back to the first few personas of their own
 * industry catalog rather than to nothing, so the loop still has real roles in
 * it. It never falls back to invented ones.
 */
export function buildBriefingPersonas(
  catalog: ResolvedQuizCatalog | null | undefined,
  pickedIds: readonly string[] | null | undefined,
  fallbackCount = 3,
): BriefingPersona[] {
  const all = (catalog && catalog.personas) || [];
  const picked = pickedIds || [];
  const chosen = picked.length
    ? all.filter((p) => picked.indexOf(p.id) >= 0)
    : all.slice(0, fallbackCount);
  return chosen.map((p) => ({
    id: p.id,
    name: p.title,
    role: p.description || "",
    draft: briefingDraft(p.title, p.description || "", 0),
    status: "pending" as const,
    regenerations: 0,
    ownWords: "",
    source: "placeholder" as const,
  }));
}

/** Replace one persona in a list, by id, leaving the rest untouched. */
function patch(
  personas: readonly BriefingPersona[],
  id: string,
  fn: (p: BriefingPersona) => BriefingPersona,
): BriefingPersona[] {
  return personas.map((p) => (p.id === id ? fn(p) : p));
}

/** "Yes, that's us." */
export function confirmPersona(personas: readonly BriefingPersona[], id: string): BriefingPersona[] {
  return patch(personas, id, (p) => ({ ...p, status: "confirmed" }));
}

/** "That's not us." Opens the resolution choices; does not itself resolve anything. */
export function rejectPersona(personas: readonly BriefingPersona[], id: string): BriefingPersona[] {
  return patch(personas, id, (p) => ({ ...p, status: "rejected" }));
}

/** Whether another regeneration is still on offer for this persona. */
export function canRegenerate(persona: BriefingPersona | null | undefined): boolean {
  return !!persona && persona.regenerations < BRIEFING_MAX_REGENERATIONS;
}

/**
 * Ask for another attempt at this persona.
 *
 * STUB. Advances to the next placeholder phrasing and returns the persona to
 * `pending` so it is re-reviewed. The real version of this function is a model
 * call grounded on the quiz answers and the finished scan; everything around it
 * — the cycle count, the cap, the re-review, the UI — is real now and does not
 * change when that call is wired in.
 *
 * A no-op once the cap is reached, so a stale button can never spend a cycle
 * that the scene has stopped offering.
 */
export function regeneratePersona(personas: readonly BriefingPersona[], id: string): BriefingPersona[] {
  return patch(personas, id, (p) => {
    if (!canRegenerate(p)) return p;
    return {
      ...p,
      draft: briefingDraft(p.name, p.role, p.draft.variant + 1),
      status: "pending",
      regenerations: p.regenerations + 1,
    };
  });
}

/**
 * The customer describes the role in their own words.
 *
 * Stores the text verbatim and keeps the placeholder draft alongside it, because
 * whether that text becomes the persona's content or becomes grounding for a
 * further real generation attempt is open question (1) above. Both reads are
 * available off this state; only the presentation would change.
 *
 * Empty input is rejected rather than silently confirming an empty persona.
 */
export function describePersona(
  personas: readonly BriefingPersona[],
  id: string,
  text: string,
): BriefingPersona[] {
  const words = (text || "").trim();
  if (!words) return personas as BriefingPersona[];
  return patch(personas, id, (p) => ({
    ...p,
    ownWords: words,
    source: "customer",
    status: "confirmed",
  }));
}

/** A persona is settled once the customer has confirmed it, however it got there. */
export function isPersonaSettled(persona: BriefingPersona | null | undefined): boolean {
  return !!persona && persona.status === "confirmed";
}

/** The index of the first persona still awaiting the customer, or `-1` when all are settled. */
export function nextUnsettledIndex(personas: readonly BriefingPersona[]): number {
  return personas.findIndex((p) => !isPersonaSettled(p));
}

/**
 * Whether the scene has finished — which is the ONLY thing that may release
 * `enterRoom()` / `startArrivals()`.
 *
 * An empty roster counts as complete. A customer whose industry catalog has no
 * personas to confirm must not be stranded on a scene with nothing in it.
 */
export function isBriefingComplete(personas: readonly BriefingPersona[]): boolean {
  return personas.every(isPersonaSettled);
}

export interface BriefingProgress {
  readonly settled: number;
  readonly total: number;
  /** `0`–`1`, for the progress rail. `1` on an empty roster. */
  readonly fraction: number;
  readonly complete: boolean;
}

export function briefingProgress(personas: readonly BriefingPersona[]): BriefingProgress {
  const total = personas.length;
  const settled = personas.filter(isPersonaSettled).length;
  return {
    settled,
    total,
    fraction: total ? settled / total : 1,
    complete: settled >= total,
  };
}

/**
 * What the scene should be offering for a rejected persona right now.
 *
 * `"choose"` — regeneration is still available alongside describing it yourself.
 * `"describe-only"` — the cap is spent; this is the different resolution path,
 * and the copy that goes with it should say so rather than silently hiding a
 * button the customer was using a moment ago.
 */
export function rejectionOptions(persona: BriefingPersona | null | undefined): "choose" | "describe-only" {
  return canRegenerate(persona) ? "choose" : "describe-only";
}
