/**
 * kbData.ts — the knowledge-base fixture, ported value-for-value from the
 * prototype's `KB_CATS` / `KB_ARTICLES` (Customer Portal Shell.dc.html
 * 7923-8141) and the `kbPageName` map (shell 13934).
 *
 * ── Why this is a fixture, and why that is correct here ─────────────────────
 * The handoff README lists the palette index and document generation as backend
 * work, but the knowledge base itself is finished copy in the prototype — 22
 * articles across 8 categories, all written in Shane's voice. Copy is FINAL, so
 * every string here is the prototype's verbatim; the audit script treats a
 * design string as a reliable probe precisely because it must not be rewritten.
 *
 * ── Routes, not `active` keys ──────────────────────────────────────────────
 * The prototype has no router: an article's `page` and an action's `act` are
 * `setState` keys. This build is routed, so the design keys are resolved to real
 * URLs through `KB_PAGE_ROUTES` / `kbActionHref`. Pages and actions whose target
 * route does NOT yet exist (another part of the portal build owns them — see
 * PORTAL_V2_PARALLEL_PLAN.md) resolve to `null` and their button is simply not
 * drawn, rather than shipping a link that 404s. Every button that renders goes
 * somewhere real.
 */

export interface KbCategory {
  readonly k: string;
  readonly label: string;
}

export interface KbBodyBlock {
  readonly h: string;
  readonly p?: string;
  readonly steps?: readonly string[];
}

export interface KbAction {
  readonly label: string;
  readonly sub: string;
  readonly act: string;
}

export interface KbArticle {
  readonly id: string;
  readonly cat: string;
  /** The design `active` key of the page this article is "for", if any. */
  readonly page?: string;
  readonly title: string;
  readonly summary: string;
  readonly body: readonly KbBodyBlock[];
  readonly actions?: readonly KbAction[];
  readonly related?: readonly string[];
}

/** `KB_CATS` — shell 7923-7932. Order is the browse order. */
export const KB_CATS: readonly KbCategory[] = [
  { k: "start", label: "Getting around" },
  { k: "change", label: "Change control" },
  { k: "own", label: "Ownership" },
  { k: "comply", label: "Compliance" },
  { k: "ms", label: "Microsoft changes" },
  { k: "run", label: "Runbooks & SOPs" },
  { k: "money", label: "Licensing & billing" },
  { k: "health", label: "Tenant health" },
];

/** `KB_ARTICLES` — shell 7933-8141, verbatim. */
export const KB_ARTICLES: readonly KbArticle[] = [
  {
    id: "portal-overview",
    cat: "start",
    page: "home",
    title: "How this portal works",
    summary: "Six pillars, one scan, and a record behind every number.",
    body: [
      { h: "What you are looking at", p: "Your tenant is read on a scan and graded across six pillars: governance, security, compliance, licensing, adoption and health. Everything on every page comes from that read. Nothing is estimated and nothing is carried over from a previous customer." },
      { h: "The scan", p: "A full read runs daily. The time of the last one is shown on the overview, and every figure carries the scan it came from. If a number looks wrong, the first question is always which scan it is from." },
      { h: "Numbers open", p: "Any stat box on any page opens to show what is behind it: the objects it counts, the policy that caused it, and what it costs you. If a number cannot be broken down, the box says so rather than pretending." },
      { h: "Nothing changes without a record", p: "Every action that touches the tenant raises a change request first, unless change control is switched off for this tenant. What actually ran is logged against the request." },
    ],
    related: ["cr-raise", "raci-what"],
  },
  {
    id: "scans-evidence",
    cat: "start",
    title: "Scans, evidence packs and proof",
    summary: "Where the numbers come from and how to hand them to an auditor.",
    body: [
      { h: "What a scan reads", p: "Microsoft Graph for directory, licensing, devices and policy; PowerShell for the parts Graph does not expose, mainly SharePoint, Exchange transport and Purview. Every page lists its own calls under provenance." },
      { h: "Evidence packs", p: "An evidence pack is a point-in-time export of a finding: the reading, the call that produced it, the timestamp, and the action taken. Packs are what you give an auditor instead of a screenshot." },
      { h: "Making one", steps: ["Open the finding you want to evidence.", "Use Evidence pack in the header of the pillar page.", "Choose the scans to include — a range shows the trend rather than a single moment.", "Export. The pack carries the tenant name, the scan numbers and the calls used."] },
    ],
    actions: [{ label: "Open the evidence pack", sub: "Point-in-time export of a finding", act: "evidence" }],
    related: ["portal-overview"],
  },
  {
    id: "cr-raise",
    cat: "change",
    title: "Raise a normal change request",
    summary: "Nine fields, two signatures, a window and a way back.",
    body: [
      { h: "When to use it", p: "Any change to the tenant that is not in the standard catalogue and is not an emergency. If you are unsure which of the three it is, raise it as normal — it can be reclassified before approval." },
      { h: "How", steps: ["New → Change request, or Raise a change from any finding, which prefills what it already knows.", "Describe what changes and what it touches. The impact assessment is not optional — a request with no assessment cannot be approved.", "Set the rollback point. If there is no way back, say so explicitly; that is a decision, not a blank field.", "Pick a window. The calendar shows freezes and anything Microsoft is doing in the same dates.", "Submit. It goes to whoever is Accountable for the object it touches."] },
      { h: "What blocks approval", p: "A missing impact assessment, a missing rollback, a window inside a declared freeze, or the same person raising and approving. The completeness gate lists what is outstanding." },
    ],
    actions: [
      { label: "Raise a normal change now", sub: "Opens the nine-field form", act: "cr-normal" },
      { label: "Open the register", sub: "Every change, filterable", act: "go:change-control:register" },
    ],
    related: ["cr-emergency", "cr-standard", "cr-freeze", "sod"],
  },
  {
    id: "cr-emergency",
    cat: "change",
    title: "Raise an emergency change",
    summary: "Something is already broken. Four fields, run now, approve within 24 hours.",
    body: [
      { h: "When it is genuinely an emergency", p: "Something is broken or actively being exploited and waiting for the normal path makes it worse. Convenience is not an emergency, and the register makes the distinction visible." },
      { h: "How", steps: ["New → Emergency change.", "State what is broken and what you are about to do. Four fields, no more.", "The pre-change state is captured automatically the moment you raise it, so the rollback is exact rather than remembered.", "Run it.", "Approve it within 24 hours. The clock is on the register and an unapproved emergency past 24 hours shows as a breach."] },
      { h: "Freezes", p: "An emergency is exempt from a freeze only with the freeze owner's written approval, and the approval is recorded against both the change and the freeze." },
    ],
    actions: [{ label: "Raise an emergency change now", sub: "Four fields, 24-hour approval clock starts", act: "cr-emergency" }],
    related: ["cr-raise", "cr-freeze"],
  },
  {
    id: "cr-standard",
    cat: "change",
    title: "Use a standard change from the catalogue",
    summary: "Pre-approved, repeatable, no signature needed.",
    body: [
      { h: "What a standard change is", p: "A change that has been done enough times, with a known result and a known rollback, that it has been pre-approved once and does not need approving again each time. Adding a user to a group is a standard change. Changing a Conditional Access policy is not." },
      { h: "How", steps: ["Change Control → Catalogue.", "Find the change. Search by what you are trying to do, not by its title.", "Check the last-run result and the failure rate shown on the card.", "Run it. It lands on the register as executed, with the catalogue reference and who ran it."] },
      { h: "Getting something added", p: "Propose it from the catalogue page. A change becomes standard after three clean runs with no rollback, reviewed by whoever is Accountable for the service it touches." },
    ],
    actions: [{ label: "Open the catalogue", sub: "Pre-approved standard changes", act: "go:change-control:catalogue" }],
    related: ["cr-raise"],
  },
  {
    id: "cr-freeze",
    cat: "change",
    title: "Declare a freeze window",
    summary: "A period when nothing ships, and what happens to anything already booked.",
    body: [
      { h: "What it does", p: "A freeze blocks every change window inside its dates. Anything already booked into those dates is flagged and has to move or get written approval from the freeze owner." },
      { h: "How", steps: ["New → Freeze window, or Change Control → Freezes and notices.", "Set the dates and the scope. Whole tenant is the default; a scoped freeze names the services it covers.", "Name the owner. That is who grants exceptions, and it should not be the person most likely to want one.", "State the emergency position — exempt with written approval, or exempt outright.", "Declare it. Everyone with an open change in the dates is told immediately."] },
      { h: "Microsoft does not observe your freeze", p: "The calendar shows Microsoft releases landing inside your freeze dates. Those are not blocked by it — they need an opt-out or a change of their own." },
    ],
    actions: [
      { label: "Declare a freeze now", sub: "Dates, scope, owner, emergency position", act: "freeze" },
      { label: "Open the freeze calendar", sub: "See what is already booked", act: "go:change-control:calendar" },
    ],
    related: ["cr-emergency", "ms-waves"],
  },
  {
    id: "sod",
    cat: "change",
    title: "Separation of duties",
    summary: "Why the portal will not let you approve your own change.",
    body: [
      { h: "The rule", p: "The person who raises a change cannot approve it, and the person Responsible for an object should not also be Accountable for it. Both are enforced rather than encouraged." },
      { h: "Where it shows", p: "The ownership matrix flags any object where Responsible and Accountable are the same name. Change Control refuses the approval outright and says who it needs instead." },
      { h: "When there is nobody else", p: "Small teams hit this legitimately. The answer is a named deputy in the matrix, not an exception — a deputy is a decision you make once, an exception is one you defend every audit." },
    ],
    related: ["cr-raise", "raci-what"],
  },
  {
    id: "raci-what",
    cat: "own",
    page: "ownership",
    title: "The ownership matrix",
    summary: "Four names against everything, and what each one actually does.",
    body: [
      { h: "The four", p: "Responsible does the work. Accountable answers for it and is the only one who can approve. Consulted is asked before a decision. Informed is told after. One name per role per object." },
      { h: "Never a group for Responsible", p: "A group cannot be chased and cannot accept. Groups are legitimate for Informed, occasionally for Consulted, never for Responsible." },
      { h: "What reads from it", p: "Change approvals, alert routing, escalation, announcements, the fix panel, runbooks and the evidence pack. Change a name here and every one of those changes with it." },
    ],
    actions: [
      { label: "Open the matrix", sub: "Four names against everything", act: "go:ownership" },
      { label: "Add a row", sub: "Put a name against something not covered", act: "go:ownership" },
    ],
    related: ["raci-accept", "raci-cover", "raci-escalate", "sod"],
  },
  {
    id: "raci-accept",
    cat: "own",
    title: "Acceptance: why a name is not enough",
    summary: "An unaccepted name is a claim, not a commitment.",
    body: [
      { h: "The problem", p: "Putting somebody's name in a matrix does not mean they know, and it certainly does not mean they agreed. Six months later that is the difference between an owner and an argument." },
      { h: "How it works", p: "Assigning a Responsible or Accountable name sends it to that person to accept. Until they do, the cell carries a circled cross and the object counts as unowned in the coverage figures." },
      { h: "Chasing it", steps: ["Ownership → the cell shows the pending state.", "Nudge sends a reminder with what they are being asked to own.", "If it stays unaccepted past the escalation window it goes to the Accountable name."] },
    ],
    related: ["raci-what", "raci-escalate"],
  },
  {
    id: "raci-cover",
    cat: "own",
    title: "Cover, deputies and handovers",
    summary: "What happens to routing when somebody is away.",
    body: [
      { h: "Standing deputy", p: "Each person can have a permanent deputy, used whenever they are marked away. It is set on the person card in People and roles." },
      { h: "A dated handover", steps: ["Open the person from the load list.", "Hand over — pick who covers, the end date, and whether it is everything or one category.", "The handover shows as a chip on the person and expires on its own."] },
      { h: "What routing does", p: "Anything routed to somebody who is away goes to their cover for the dates of the handover, and the notice says whose work it is and why they are getting it." },
    ],
    actions: [{ label: "Set up a handover", sub: "Pick who covers, until when, and how much", act: "go:ownership" }],
    related: ["raci-what", "routing"],
  },
  {
    id: "raci-escalate",
    cat: "own",
    title: "The escalation clock",
    summary: "What happens when the responsible name goes quiet.",
    body: [
      { h: "The rule", p: "If nothing moves on an item for the set number of days, it goes to the Accountable name and the matrix cell shows an hourglass. The default is five days and it is set in Settings → Ownership routing." },
      { h: "What counts as movement", p: "A step ticked, a decision recorded, a comment, or a change request raised. Reading it does not count." },
    ],
    related: ["routing", "raci-what"],
  },
  {
    id: "routing",
    cat: "own",
    page: "settings",
    title: "Ownership routing rules",
    summary: "The six rules that turn the matrix into behaviour.",
    body: [
      { h: "Where", p: "Settings → Ownership routing. Each rule can be switched off, and switching one off leaves the ownership visible but stops it doing anything." },
      { h: "The rules", p: "Tell the informed name; route approvals to the accountable name; ask the consulted name before booking a window; escalate when responsible goes quiet; block routing where there is no name; follow cover when someone is away." },
      { h: "Live, not copied", p: "Every rule reads the matrix at the moment it fires. There is no separate routing list to keep in step." },
    ],
    actions: [{ label: "Open ownership routing", sub: "The six rules and the escalation window", act: "go:settings:routing" }],
    related: ["raci-what", "raci-cover"],
  },
  {
    id: "cmp-gaps",
    cat: "comply",
    page: "compliance-open-gaps",
    title: "Open gaps and what to do with one",
    summary: "Fix it, or decide to live with it. Doing neither is the only wrong answer.",
    body: [
      { h: "What a gap is", p: "A fact about your tenant that a named obligation does not permit. Each one cites the obligation and shows the evidence behind the reading." },
      { h: "Two honest endings", p: "Fix it, which raises a change request. Or record a policy decision, which leaves the gap in place with an owner, a rationale, a compensating control and a review date. Both are defensible. An untouched gap is not." },
      { h: "Retroactivity", p: "Most compliance gaps cannot be backfilled. Retention only preserves from the day it is applied; audit records only exist for as long as the policy in force when they were written. That is why the page is ordered by what expires first." },
    ],
    actions: [{ label: "Open the gaps list", sub: "Each one cites its obligation", act: "go:compliance-open-gaps" }],
    related: ["cmp-decision", "cmp-obligations"],
  },
  {
    id: "cmp-decision",
    cat: "comply",
    page: "policy-decisions",
    title: "Record a policy decision",
    summary: "How to accept a gap so it reads as a decision and not neglect.",
    body: [
      { h: "What makes it a decision", p: "An accountable name, a written rationale, a compensating control, and a date it gets looked at again. Miss any of the four and it is just an excuse with a reference number." },
      { h: "How", steps: ["Open the gap and choose Record a policy decision instead. It prefills from the finding.", "Name who is accountable — the person who will defend it, not the person who noticed it.", "Write the rationale in plain terms. An auditor reads this, not your ticket system.", "State the compensating control and how you know it is working.", "Set the review period. Shorter for anything that changes often."] },
      { h: "Reviews", p: "A decision past its review date reads as neglect. Operate → Policy Decisions counts what is due and what has expired." },
    ],
    actions: [
      { label: "Record a policy decision now", sub: "Owner, rationale, control, review date", act: "decision" },
      { label: "See what is due for review", sub: "The decisions queue", act: "go:policy-decisions" },
    ],
    related: ["cmp-gaps"],
  },
  {
    id: "cmp-obligations",
    cat: "comply",
    page: "compliance-obligations",
    title: "Obligations and scope",
    summary: "What you are being checked against, and how to change it.",
    body: [
      { h: "Scope is yours", p: "The frameworks in scope were set at onboarding. Something marked out of scope is not checked and says so on the page rather than quietly passing." },
      { h: "Changing it", p: "Tell us and every check re-evaluates on the next scan. Bringing a framework into scope usually opens gaps immediately — that is the framework being applied, not the tenant getting worse." },
    ],
    actions: [{ label: "Open obligations", sub: "What is in scope and what is not", act: "go:compliance-obligations" }],
    related: ["cmp-gaps"],
  },
  {
    id: "ms-waves",
    cat: "ms",
    page: "ms-changes",
    title: "Release waves",
    summary: "The Message Center grouped by when it lands and how wide it reaches.",
    body: [
      { h: "Why waves", p: "Four hundred notices in date order is unreadable. Grouping them by landing window and impact breadth turns them into a handful of decisions." },
      { h: "What to do with one", steps: ["Read what changes and the plain-English translation next to Microsoft's wording.", "Check the tenant impact line — it is computed against your configuration, not generic.", "Decide: accept, opt out where Microsoft allows it, or raise a change to prepare for it.", "If people will see it, use the announcement draft rather than writing one."] },
      { h: "Freezes", p: "Microsoft does not observe your freeze calendar. Anything landing inside a freeze is flagged on both pages." },
    ],
    actions: [{ label: "Open the release waves", sub: "Everything Microsoft is landing, grouped", act: "go:ms-changes" }],
    related: ["ms-decisions", "cr-freeze"],
  },
  {
    id: "ms-decisions",
    cat: "ms",
    title: "Decisions before a wave lands",
    summary: "What needs a change request or an override, and by when.",
    body: [
      { h: "The queue", p: "Every notice that needs something from you before its landing date, with the date the option to act expires. Opt-outs usually close before the change ships." },
      { h: "Missing one", p: "A missed opt-out is not recoverable — the change lands and the only route back is a change request against the new default, if one exists." },
    ],
    related: ["ms-waves"],
  },
  {
    id: "run-execute",
    cat: "run",
    page: "operate-runbooks",
    title: "Running a runbook",
    summary: "Steps, hold windows, and what makes it evidence.",
    body: [
      { h: "Before you start", p: "A runbook that changes the tenant raises its change request first. The runbook will tell you which one and will not let you tick a step until it is approved." },
      { h: "Ticking steps", p: "Each step is ticked by a named person with a timestamp. That is what makes the completed runbook evidence rather than a checklist somebody may have followed." },
      { h: "Hold windows", p: "A deliberate pause with a gate: a wait period, a confirmation, or a business sign-off. A runbook in a hold window is not stalled — it is waiting on the thing the hold names, and the top bar counts how many are due." },
    ],
    actions: [{ label: "Open active runbooks", sub: "What is running and what is waiting", act: "go:operate-runbooks" }],
    related: ["run-library", "cr-raise"],
  },
  {
    id: "run-library",
    cat: "run",
    page: "sop-hub",
    title: "The SOP and runbook library",
    summary: "Ours and yours, and how to tell them apart.",
    body: [
      { h: "Two sources", p: "Procedures we maintain, which update as Microsoft changes, and procedures you have written, which are yours. Both are versioned and both show when they were last reviewed." },
      { h: "Writing one", steps: ["New → Procedure.", "Say what triggers it before you say what to do. Most bad runbooks fail because nobody knows when to reach for them.", "One action per step, in the order they happen.", "Name who runs it and who is accountable — it reads those from the ownership matrix.", "Set a review cadence. A runbook nobody has read in two years is a liability."] },
    ],
    actions: [
      { label: "Write a procedure now", sub: "Opens the SOP draft", act: "sop" },
      { label: "Open the library", sub: "Ours and yours", act: "go:sop-hub" },
    ],
    related: ["run-execute"],
  },
  {
    id: "lic-recover",
    cat: "money",
    page: "licensing",
    title: "What licence money is actually recoverable",
    summary: "Removable today, recoverable at renewal, reassignable now — and why the difference matters.",
    body: [
      { h: "Three kinds of money", p: "Removable today is monthly-billed and reaches the next invoice. Recoverable at renewal is on an annual commitment and only drops if the reduction is lodged before the renewal date. Reassignable now changes nothing on the invoice at all — it is capability you already bought sitting with people who are not using it." },
      { h: "Active is not sign-in", p: "Active means thirty-day service or app activity. Somebody who signs in daily and has never opened Visio is not an active Visio user, and the ledger counts them accordingly." },
      { h: "The ledger", p: "One bar per SKU: what runs, what is assigned and idle, and what is assigned to nobody. The action to close the gap sits on the same card as the gap." },
    ],
    actions: [{ label: "Open the licence ledger", sub: "What you buy against what runs", act: "go:licensing" }],
    related: ["bill-sub"],
  },
  {
    id: "bill-sub",
    cat: "money",
    page: "billing",
    title: "Your subscription and receipts",
    summary: "What you pay for, how to change it, and where the receipts are.",
    body: [
      { h: "What you are paying for", p: "Recurring monitoring, the retainer, any add-on modules, and one-time pieces of work. Each is shown separately with what it covers." },
      { h: "Changing it", p: "Tier changes and add-ons take effect immediately and are prorated by Stripe. Switching to yearly is applied at the next renewal and the saving is shown in money before you confirm." },
      { h: "Receipts", p: "Everything is charged through Stripe, which issues the receipt. There are no invoices to chase and no payment details held here." },
    ],
    actions: [{ label: "Open billing", sub: "Your plan, add-ons and receipts", act: "go:billing" }],
    related: ["lic-recover"],
  },
  {
    id: "hlt-drift",
    cat: "health",
    page: "health",
    title: "Configuration drift",
    summary: "A setting that moved. The question is whether a change request moved it.",
    body: [
      { h: "The baseline", p: "Forty-seven settings were recorded at scan 1 and are compared on every scan since. Drift is any difference from that baseline." },
      { h: "The verdict matters more than the drift", p: "A setting that moved with an approved change request is change control working. The same setting moving with no request behind it is the finding. Settings changed before the baseline have no actor at all and need a decision rather than a revert." },
      { h: "Re-signing", p: "Once each drift is reverted or adopted, the baseline is re-signed and the comparison starts from the new state." },
    ],
    actions: [{ label: "Open configuration drift", sub: "What moved, and whether a CR moved it", act: "go:health" }],
    related: ["cr-raise", "sod"],
  },
];

/** Category label for an article's `cat` — used by the reading view kicker. */
export function kbCatLabel(cat: string): string {
  return KB_CATS.find((c) => c.k === cat)?.label ?? "";
}

/**
 * `kbPageName` — shell 13934, verbatim. The human label for a design page key,
 * used on the "Open <page>" button. Not every key here has a route yet.
 */
const KB_PAGE_NAME: Readonly<Record<string, string>> = {
  home: "the overview",
  ownership: "Ownership",
  settings: "Settings",
  compliance: "Compliance",
  "compliance-open-gaps": "Open gaps",
  "compliance-obligations": "Obligations",
  "policy-decisions": "Policy Decisions",
  "ms-changes": "Microsoft Changes",
  "operate-runbooks": "Active Runbooks",
  "sop-hub": "SOPs & Runbooks",
  licensing: "Licensing",
  billing: "Billing",
  health: "Health",
};

export function kbPageName(page: string): string | null {
  return KB_PAGE_NAME[page] ?? null;
}

/**
 * Design page key → real `/portal-v2` route. ONLY the pages that already exist
 * in this build appear here; the rest resolve to `null`, which suppresses
 * their button rather than shipping a dead link.
 */
const KB_PAGE_ROUTES: Readonly<Record<string, string>> = {
  home: "/portal-v2",
  ownership: "/portal-v2/ownership",
  settings: "/portal-v2/settings",
  compliance: "/portal-v2/compliance",
  "compliance-open-gaps": "/portal-v2/compliance/open-gaps",
  "compliance-obligations": "/portal-v2/compliance/obligations",
  "policy-decisions": "/portal-v2/policy-decisions",
  "ms-changes": "/portal-v2/ms-changes",
  "operate-runbooks": "/portal-v2/runbooks",
  "sop-hub": "/portal-v2/sops",
  licensing: "/portal-v2/licensing",
  billing: "/portal-v2/billing",
  health: "/portal-v2/health",
};

/**
 * Pages whose `go:<page>:<sub>` actions carry a real deep-linkable sub-view
 * segment (App.tsx's `/portal-v2/<page>/:view` routes), rather than a sub
 * that should be dropped. `change-control` was missing from `KB_PAGE_ROUTES`
 * entirely, so every `go:change-control:*` action (register/catalogue/
 * calendar) silently resolved to null even though the module has been live
 * since Part 4.
 */
const KB_SUBVIEW_PAGES: Readonly<Record<string, { base: string; valid: ReadonlySet<string> }>> = {
  "change-control": {
    base: "/portal-v2/change-control",
    valid: new Set(["briefing", "register", "catalogue", "calendar", "review", "settings"]),
  },
  settings: {
    base: "/portal-v2/settings",
    valid: new Set(["routing", "change", "people", "departments"]),
  },
};

/** The route for an article's `page`, or null when that page is not built yet. */
export function kbPageHref(page: string | undefined): string | null {
  if (!page) return null;
  return KB_PAGE_ROUTES[page] ?? null;
}

/**
 * Reverse map: which article `page` key is the CURRENT route on, so the KB can
 * surface "For the page you are on". Prefix match, longest-route first so
 * `/portal-v2/ms-changes/september` still resolves to `ms-changes`.
 */
export function kbPageKeyForRoute(location: string): string | null {
  const entries = Object.entries(KB_PAGE_ROUTES).sort((a, b) => b[1].length - a[1].length);
  for (const [key, route] of entries) {
    if (route === "/portal-v2") {
      if (location === "/portal-v2" || location === "/portal-v2/") return key;
      continue;
    }
    if (location === route || location.startsWith(`${route}/`)) return key;
  }
  return null;
}

/**
 * Resolve an article action's `act` to a real route, or null when its target
 * flow/page is not built yet. `go:<page>[:<sub>]` uses `KB_SUBVIEW_PAGES` when
 * the page has real deep-linkable sub-views, otherwise the plain page map (the
 * sub is dropped because no route reads it). The change-control intents
 * (`cr-normal` / `cr-emergency` / `freeze`) all land on the Change Control
 * module, which exists.
 */
export function kbActionHref(act: string): string | null {
  if (act.startsWith("go:")) {
    const [, page, sub] = act.split(":");
    const subPage = KB_SUBVIEW_PAGES[page];
    if (subPage) {
      return sub && subPage.valid.has(sub) ? `${subPage.base}/${sub}` : subPage.base;
    }
    return KB_PAGE_ROUTES[page] ?? null;
  }
  if (act === "cr-normal" || act === "cr-emergency" || act === "freeze") {
    return "/portal-v2/change-control";
  }
  // `evidence`, `sop`, `decision` open flows/pages that do not exist yet.
  return null;
}

/**
 * The KB browse search (shell 13938-13941): every whitespace-split word of the
 * query must appear in the article's title, summary or body text.
 */
export function kbSearch(articles: readonly KbArticle[], query: string): readonly KbArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return articles;
  return articles.filter((a) => {
    const hay = (
      a.title +
      " " +
      a.summary +
      " " +
      a.body.map((b) => `${b.h} ${b.p ?? ""} ${(b.steps ?? []).join(" ")}`).join(" ")
    ).toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}
