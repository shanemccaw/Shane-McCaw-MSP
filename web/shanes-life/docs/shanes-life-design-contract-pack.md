# Shane's Life — Design Contract Pack

**Purpose:** Real content/design brief for Claude Design, built from the locked v1 "dream
architecture" decisions already made in the original session (retrieved directly, not
reconstructed from memory), plus the real new requirements confirmed tonight (2026-09-05).
These are decisions Shane already made and corrected toward — Design should build against
them, not re-litigate them.

---

## 1. Who this is for, and why it exists — real architecture superseded, 2026-09-05

**Real pivot, replacing an earlier decision.** The original "dream architecture" session
decided this app would be built fresh, kept separate from the real ShanesSurvival
Plaid-connected money app. Shane has since corrected that: **Shane's Life IS the
cloud-hosted piece for ShanesSurvival, not a second, separate app alongside it.** One
person, one real unified system — not "a finance app" plus "a life app" that happen to
share a user.

**What this concretely means:**
- The real financial core — accounts, bills, debts, income, the GATE/shortfall math,
  everything already built and working in ShanesSurvival's local WPF app — becomes the
  cloud-hosted foundation this app is built on top of, not a separate data source it reads
  from.
- Everything else in this document (notification tray, universal capture, Shopping/
  Recipes, People & Patterns, hub-and-spoke logistics, medication, the "things that need to
  move" queue) is real, still-new functionality layered onto that same real hosted system —
  one app, one login, one real database.
- **Real decision, confirmed 2026-09-05**: the WPF app stays, but its real role narrows and
  shifts. Rather than being the primary place Shane looks at his life, it becomes a real
  local automation tool — specifically, exploring WebView2 automation to pull real coupon
  and weekly-ad data (the same real capability behind Section 5's cross-store price
  comparison, giving it a real, automated source instead of manual feeding). **The hosted
  app (this one) becomes the primary surface for money — real dashboards, account funding,
  everything Shane currently sees in the WPF Dashboard — alongside the full life-organizer
  scope.** This is Shane's own framing: "my dream of my entire life in one app."

One person: Shane. Not a multi-user product pitch — built around his specific, real
constraints:

- **Has ADHD** — shapes nearly every locked decision below, not a footnote.
- **Runs two households** — an owned "hub" and a rental "spoke."
- **A husband, a family member at the second house, cars, and a real, wide scope**:
  originally described as "food, recipes, money, tasks, appointments, prescriptions, dogs
  and cats, pool, yard work — just dam everything."
- **Non-linear daily schedule** — no consistent routine, so time-based triggers are
  unreliable. Context- and location-based triggers work; clock-based ones don't.
- **Processes best conversationally**, not through forms or structured input.
- **Real financial priority running alongside this**: NASA role + the Copilot Readiness
  consulting business, being banked on for real financial recovery.

**Real visual personality note, confirmed 2026-09-05.** Shane wants real, cute animal
"critters" in the UI, with Microsoft Clarity's real critter aesthetic as a reference
point. This is a deliberate personality/warmth choice, distinct from gamification
(Section 11) since it's decorative and delight-oriented, not a mechanic tied to streaks
or performance. **Real correction, 2026-09-07**: Shane explicitly declined any
BuildConsole cross-pollination, in either direction — critters are designed fresh for
Shane's Life and stay entirely within it, full stop. The critter set actually built
(#3119) is real, original work, not a port.

**Real "Round 2 UI" direction, confirmed 2026-09-07 — real, stated intent, design not
yet finished.** Shane is working a second design pass (same real Claude Design process
as Round 1) toward something more dynamic, prettier, and "themed cute," including real
holiday themes and real time-of-day visual changes. No real spec exists yet — this is a
real, stated direction to hold onto, not a locked requirement to build against until the
actual design lands. When it does, this note should be replaced with the real, specific
decisions the same way every other design pass tonight was.

## 2. The three real design failures this exists to fix

- **Capture friction is the core enemy.** "It's all these damn huge forms just to say I
  spent $10 or have an appointment" — Shane's own words. If logging something takes more
  than a few seconds of thought, it doesn't get logged.
- **Cognitive overhead from multiple apps/alerts/forms is worse than the problems they
  solve.** Too many individual alerts, too many separate apps — the trap Shane explicitly
  named and wants out of.
- **Guilt/shame around incomplete tasks is a non-starter.** Any UI pattern that makes Shane
  feel bad about what didn't get done will get uninstalled, not tolerated.

## 3. Locked feature decisions

- **Notification tray is the primary interface — not a dashboard.**
- **Universal capture box (text/voice/photo)**, parsed by AI, is the single entry point for
  everything. One box, not category-specific forms.
- **Real extensibility principle, confirmed 2026-09-05 — the capture box above is
  genuinely open, not a fixed list of known categories.** Shane's own example: "mom's
  coming to visit the 12th-18th" — a real thing that was never explicitly designed for.
  Real behavior needed: Claude, via MCP, gives it real live classification — the right
  category, the right icon, the right treatment — without a developer having to build a
  dedicated feature first. Every specific module in this document (appointments,
  birthdays, want-to-attend events, vet visits, and everything else) is a real,
  anticipated common case, not a closed, exhaustive list. The underlying real data model
  needs to support Claude assigning a sensible new category on the fly, not just slotting
  things into a fixed enum. This is the actual point of the whole one-box design — genuine
  extensibility, not just fewer forms.
- **Real third tier, confirmed 2026-09-05 — the capture box is a genuine command center,
  not just a smart classifier.** When something comes in that doesn't fit any real
  category at all, Claude doesn't force a bad classification — it talks it through with
  Shane, live. If that conversation reveals a real, genuine gap, it can spawn a real code
  update, the same way every real feature in this document got built tonight: Shane says
  something, Claude and Shane talk it through, and if it's real, Claude scopes and
  dispatches an actual build. That's not just how tonight happened to go — it's meant to
  be a real, designed-in part of how this app keeps growing after launch, not a one-time
  design phase that ends once the app ships.
- **Real simple lists — movies/shows to watch, recommended books, confirmed 2026-09-05.**
  A real, deliberate light-touch case: these don't need their own bespoke design, just the
  same capture box and a sensible list treatment — exactly the extensibility principle
  above, applied rather than re-explained.
- **Real federal holidays, confirmed 2026-09-05 — different in kind from everything else
  here.** Real, stated problem: "I only ever know when it's too late." Unlike birthdays
  or appointments, this needs no manual entry at all — it's a real, known public schedule
  (OPM publishes the official federal holiday calendar every year, including which
  holidays get observed on a shifted date). Real requirement: use an actual current
  source, not a one-time hardcoded list that goes stale — dates shift year to year and
  around weekends. Same real lead-time reminder pattern as birthdays/events, since Shane's
  own real NASA work schedule and bill due-dates both depend on knowing these in advance,
  not the day of.
- **Real appointment handling, confirmed 2026-09-05 — no new mechanism, just confirms the
  capture box handles this too.** One-off appointments captured exactly as natural speech —
  "dr appointment sept 3rd 2pm dr fonji" — parsed into date/time/type/provider
  automatically, no form. **Real recurring cadences that aren't simple weekly/monthly**:
  Shane has real appointments every 6 weeks and every 2 months — the recurrence model needs
  to support arbitrary real intervals, not just the generic presets most calendar tools
  offer. **Real reminder timing: the day before**, for both recurring and one-off
  appointments — this is a real, legitimate exception to "context over clock" (Section 8),
  since an appointment is inherently date-anchored. Counts against the real 1–3/day nudge
  cap above, same as everything else — not a bonus exception to it.
- **Real "ask next time" note, confirmed 2026-09-05 — threads to a specific real
  appointment, not a generic reminder.** Saying "next time at Dr. Fonji, ask about X"
  attaches that note to the next real scheduled appointment matching that provider by
  name, and surfaces it at that appointment's real day-before reminder (or the appointment
  itself) — not lost in a flat todo list. Same underlying appointment record as the bullet
  above, just with an attached note field; no separate system needed.
- **Real in-visit notes and photos, confirmed 2026-09-05 — same appointment-threading
  pattern, extended once more.** At or right after a real appointment, Shane should be able
  to capture real notes and real photos — including photos of real documents (after-visit
  summaries, prescription slips, referral papers, lab requisitions) — through the same
  universal capture box, attached to that specific appointment record. Builds a real,
  searchable history per appointment and per provider over time, not just a single
  day-before reminder that disappears once the visit passes.
- **Real birthdays/important dates for family and friends, confirmed 2026-09-05 —
  solves a real, stated problem: "I miss them all 'cause I don't know until someone tells
  me I missed it."** Captured via the same one-box capture, threaded to the person the same
  way People & Patterns (Section 7) threads observations — factual, not reflective.
  **Real timing difference from appointments**: a day-before reminder (Section 3, above)
  is too late here — a birthday reminder needs genuinely more lead time, enough to actually
  get a card or gift, not just same-day awareness. Real annual recurrence, stated once,
  respected every year (Section 8).
- **Real "want to attend" events, confirmed 2026-09-05 — same real pattern as birthdays,
  applied to one-off things Shane sees and wants to actually go to** (an air show, a
  street fair). Real, stated problem: "I always see them and wanna go then forget when and
  where." Same one-box capture, same real lead-time reminder (not same-day, enough notice
  to actually plan around it) — no new mechanism, just the same date-plus-lead-time system
  pointed at a different, lower-stakes real subject than appointments or birthdays.
- **Nudges rationed to 1–3 per day.** Never accumulate, never shame.
- **Tasks batch by real-world moment, not clock time** — "when heading out," "when at the
  store," not "at 3pm."
- **Today view shows only what's next.** Deliberately minimal, not a full list.
- **Three full-screen modes**: Shopping, Recipes, and Review (card-stack triage for idle
  moments — swipe-based).
- **Medication system**: batched by time-of-day, single swipe to complete, split into
  auto-refill and manual-watch tiers.
- **Money triage view — explicitly NOT a budget app.** Three neutral buckets: Protected /
  Urgent / Already Handled. No categories, no charts, no monthly totals.
- **Real "available to spend" + "what if I spend $X" check, confirmed 2026-09-05, meant to
  work from Claude mobile while Shane is out.** Given Section 1's real architecture
  pivot, this isn't a second system reading someone else's data — the real financial data
  IS this app's data. This is the exact real capability the cloud-hosted piece exists to
  provide: real, live balances and shortfall math, reachable from Claude mobile, not just
  Claude Desktop on Shane's PC.
- **Real transfer simulator — "what if," confirmed 2026-09-05.** Real transfer automation
  (actually initiating a bank transfer) isn't buildable — Plaid is read-only, and NFCU
  doesn't support Plaid's real Transfer product either (confirmed earlier tonight). But the
  real decision-support layer is: Shane describes a hypothetical transfer ("move $500 from
  DirectDeposit to Mortgage"), and the app computes the real resulting state — updated
  shortfall, updated pay-period forecast, whether anything else goes unfunded — before
  Shane touches anything at the real bank. It never executes anything; it's a real, instant
  "what would this actually do" answer, replacing the manual back-and-forth Shane and
  Claude did by hand tonight for the real mortgage/electric/Tesla split decision.
- **Real bill due-date notifications, confirmed 2026-09-05 — real reuse, not a
  duplicate.** Once Money unifies (Section 1), bill due dates are already real data
  ShanesSurvival tracks (`due_day` per account) — the notification tray surfaces that
  same real data, it doesn't maintain a second, separate due-date tracker.
- **Real Tax Levy payment reminder, confirmed 2026-09-05 — the real, existing $242/month
  IRS installment (already tracked in ShanesSurvival's `debts` table, due the 12th of each
  month starting November).** Same real reuse principle as bill due dates above — this is
  a genuinely high-stakes one given the real levy history, worth a real, distinct nudge,
  not just lumped anonymously into a general bill list.
- **Real, important limitation, confirmed 2026-09-05 — Shane asked whether Claude itself
  could proactively check in mid-conversation ("Shane, have you covered the Tax Levy?")
  even in an unrelated chat.** That's not how Claude's memory system actually works, by
  design — memory surfaces information relevant to what's being asked, it doesn't
  interject unprompted into a different conversation. **The real, buildable version of the
  same underlying goal is the notification tray itself** (already locked as this app's
  primary interface, Section 3) — a real, reliable push notification at the right real
  time doesn't depend on which conversation happens to be open, and achieves the actual
  goal (a proactive reminder Shane doesn't have to remember to ask for) better than relying
  on Claude's own chat behavior would anyway.
- **Real per-vehicle financial tracking, confirmed 2026-09-05 — cars belong in the
  unified Money picture (Section 1), not a separate maintenance calendar.** Shane's real
  focus: cars as part of real financial decision-making, not just "remind me about oil
  changes." Real per-vehicle profile (Tesla Model 3, Kia Forte, confirmed via the real
  Allstate policy) aggregating what's already tracked separately today — real loan balance/
  payment, real insurance cost, real registration renewal date/cost, real maintenance
  spend — so a real question like "is this car actually worth keeping given what it
  costs" has a real, aggregated answer instead of scattered numbers across different bills.
  Registration renewal and oil-change intervals reuse the real irregular-interval pattern
  already built for appointments/vaccines (Section 3/6), with real lead time, not
  same-day awareness.
- **Real correction, confirmed 2026-09-05 — Pool and Yard are simple recurring bills, not
  a maintenance-tracking problem.** Pool service ($100/month) and a yard guy ($80/month)
  already handle the real work — these are just two more real bills belonging in the
  unified Money system (Section 1) once it exists, same as every other bill already
  tracked. No separate module needed, unlike Cars or Pets.
- **Real service provider contacts, confirmed 2026-09-05.** Plumber, electrician, AC
  repair, whoever's real fixed something before — name, phone, what they did, which house.
  Solves the real problem of digging through old texts trying to remember who to call.
  Low-sensitivity, straightforward capture via the same one-box pattern as everything
  else.
- **Real bill-payment reference vault, confirmed 2026-09-05 — genuinely sensitive, needs
  real security engineering, not a casual text field.** Real problem stated: Shane
  currently screenshots his NFCU account number and copy-pastes from the screenshot every
  time he needs to enter it on a third-party bill site (mortgage servicer, Chrysler
  Capital) that doesn't save it. This is real financial account data — it needs genuine
  encryption at rest and real access controls from the first version, not "add it later."
  **This is explicitly flagged as a real security requirement, not optional polish** — the
  same seriousness this whole app already applies to Money (Section 1). Real scope: which
  website to use per bill, and the specific real account number needed there, retrievable
  without a screenshot round-trip.
- **Real Wins log, confirmed 2026-09-05 — deliberately distinct from the "no gamification"
  rule (Section 3/8).** Streaks, badges, and completion percentages are still explicitly
  cut — those are arbitrary game mechanics that create pressure and comparison. A Wins log
  is different in kind, not just in name: it acknowledges genuine, hard-won real-world
  milestones — a mortgage payment actually made after being behind, an IRS levy actually
  resolved, Tesla actually brought current. No mechanic to break, no streak to lose, nothing
  to compare against. Real trigger points once Money unifies (Section 1): a debt's real
  balance hitting $0, a critical debt (Section on `is_critical`) getting resolved, a
  deferred bill finally caught up. Also capturable manually through the same universal
  capture box as everything else — Shane should be able to just say "I did it" and have it
  land here. Given how much real hardship this app exists to help navigate, a genuine
  record of real relief moments is a real, deliberate counterweight to the triage-only
  framing of Money — not decoration, not engagement bait.
- **Real "Budget Day" ritual, confirmed 2026-09-05 — anchored to Shane's actual real
  biweekly payday (every other Friday), already tracked as `next_pay_date`/
  `pay_frequency_days` on the real income source once the Section 1 unification lands.**
  Distinct from the separate Sunday meal-planning ritual (Section 5) — two different real
  recurring anchors, not the same day. On Budget Day, the app's real job is helping Shane
  stretch a genuinely limited real paycheck as far as possible — "extreme couponing" in
  Shane's own words. This is the real cross-store price comparison and coupon/weekly-ad
  work from Section 5, turned toward its most aggressive, real-savings-maximizing use: given
  the real amount landing this check and what's actually due, where can this specific
  paycheck's real grocery/household spend get the deepest real discount, not just "a"
  discount.
- **Money triage includes background price watchers** on blocked/deferred items, plus a
  sale webhook proposing reallocation against real current priorities.
- **The app should model Shane's own recurring habits into the money math automatically**
  — e.g., knowing Shane tends to buy cigarettes on a given day and accounting for that in
  "available to spend," without being told each time.
- **Real smoking tracker, confirmed 2026-09-05 — real, deliberate exception to the
  no-guilt principle, corrected by Shane directly.** Shane wants to quit, and explicitly
  wants real financial confrontation here, not neutral-only framing: e.g., "you're short
  $X this cycle, and $Y of that went to cigarettes" — a real, factual comparison between
  actual spend and actual shortfall. This is a deliberate, Shane-chosen override of the
  general no-guilt principle (Section 8), scoped to this one feature — not a default
  applied elsewhere. **Real behavioral note, also from Shane**: he starts and stops
  smoking cyclically, not linearly — so a traditional "days smoke-free streak" (which
  resets to zero on a slip) doesn't fit his real pattern anyway and isn't the mechanism
  here. The financial comparison works differently: it's a true statement about what
  already happened, regardless of whether Shane is currently mid-attempt or not, not a
  counter that resets and re-shames a restart. Each real cigarette still logged via the
  same one-box capture as everything else; the real financial tie-in (see the
  habit-modeling bullet above) is the actual mechanism, not a streak.
- **Hub-and-spoke household logistics**: supplies default to the owned house, split/
  transported to the rental only when Shane is actually heading that direction. Groceries
  are the explicit exception.
- **"Heading Out" checklist triggered by Tesla climate preconditioning**, not a scheduled
  time.
- **Real second context-trigger, confirmed 2026-09-05: BuildConsole build-queue depth.**
  Same real pattern as the Tesla trigger above, applied to a second genuine real-world
  context — when the queue is stacked deep (e.g., 15-20 builds running in parallel), that's
  a real, honest signal Shane isn't needed at the keyboard. BuildConsole fires a real
  webhook at that threshold, surfacing a nudge to knock out a real physical task —
  weed-eating, lawn, cleaning a room — while the builds run themselves. **Real open
  technical question, not yet confirmed**: whether BuildConsole currently has outbound
  webhook capability at all — verify before assuming this is a simple wiring job.
- **Real location-aware content surfacing, confirmed 2026-09-05 — generalizes the
  location-trigger principle beyond the single Heading Out example.** Real behavior:
  detecting where Shane actually is (Walmart, home, NASA/work) and automatically surfacing
  the relevant real content for that place — the Walmart list at Walmart, home tasks at
  home, work items at work. Same real hub-and-spoke idea (Section 3) generalized further:
  not just "which house am I at," but "which real place am I at, and what does this place
  need to show me" — across shopping lists and tasks broadly, not one narrow case. **Real
  technical honesty**: genuine phone-level location/geofencing is a meaningfully bigger
  real lift than most of what's in this document so far — needs real scoping (accuracy,
  battery impact, per-location radius tuning), not assumed simple.
- **Item location memory logs instantly, no confirmation step.**
- **A lightweight "things that need to move or get known" queue**, distinct from Shane's
  own tasks — e.g., "no toilet paper at House B" or "grab the weedeater from House A, bring
  it to House B" gets logged as known information, visible when relevant, not automatically
  owned by Shane to personally fulfill.

## 4. Real expense-cutting mechanisms, confirmed 2026-09-05

Real ideas beyond couponing/price-watching (Section 3) and meal planning (Section 5),
grounded in patterns from tonight itself — all confirmed wanted:

- **Subscription/renewal watch.** Once Money is unified with ShanesSurvival's real data
  (Section 1), the app should flag real renewal dates before they auto-bill at a higher
  rate — the exact real pattern behind tonight's Allstate lapse-and-reinstatement. A nudge
  before renewal beats finding out after.
- **"Forgotten money" sweep.** Tonight's real couch-cushion search (Jake's account,
  Emergency Fund, OnePay, Apple Cash) turned up over $1,500. A periodic real nudge —
  "when did you last check for old/forgotten accounts" — not automated (can't scan accounts
  that aren't linked), just a recurring prompt to go look.
- **Duplicate-request catch.** If Ronnie and DJ both mention needing something similar
  without knowing it, the app catches it before Shane buys it twice.
- **Borrowed-from-bill detection.** Already a real, parked idea in ShanesSurvival (#2886) —
  catching money pulled from a bill account for something other than its own real bill.
  Once Money unifies (Section 1), this becomes real, live protection here too, not just a
  future ShanesSurvival-only feature.
- **Bulk-buy suggestion from real patterns.** Same pattern-anticipation principle already
  locked in (Section 8), pointed at recurring purchases: if something gets bought often in
  small amounts (same real shape as the 7-Eleven finding), the app should surface "this
  might be cheaper bought in bulk."

## 5. Food — Shopping and Recipes, real superseding update (2026-09-05)

**Supersedes the original session's cut.** The original decision (no inventory, no
expiration tracking, no recipe-from-pantry generation, no meal planning — "that's not even
my area") was made before Shane knew what was actually possible with Claude + MCP. Tonight,
Shane demonstrated the real replacement: asking Claude conversationally for a shopping list
under a real budget, generated in full, pushed to a hosted, shareable checklist. That's the
real, wanted shape of Shopping and Recipes going forward — not a traditional in-app
database Shane manages by hand.

**Real scope now:**
- **Shopping and Recipes are real, wanted full-screen modes** (already anticipated in
  Section 3's original list) — populated by Claude-generated content pushed in via MCP, not
  built as an in-app database/form system.
- No separate recipe-authoring UI, no manual meal-planning calendar — the generation
  happens in a Claude conversation, the app's job is to host, display, and let Shane check
  items off, same division of labor as the rest of this app (see Section 10).
- **The original cut still stands for what it was actually about**: no automatic inventory/
  expiration tracking, no recipe-from-pantry-contents generation. Those remain out of
  scope — this update is about *how* Shopping/Recipes get populated (Claude + MCP, on
  request), not about resurrecting pantry-management features Shane already ruled out.
- **The Money-feeder use case still applies, separately**: when Ronnie/DJ mention something
  they need, that's still real budget-awareness information feeding the Money triage view,
  distinct from Shane actively generating his own shopping/recipe lists via Claude.
- **Real health context factored into meal/recipe generation, confirmed 2026-09-05.**
  Shane's real cardiac health condition (stage 2 heart disease, hypertension) should
  inform Claude's real recipe and meal suggestions — heart-healthy choices favored, not a
  generic recipe list indifferent to it. Same "state once, respected everywhere forever"
  principle already locked (Section 8) — this is stated once, real health information
  Shane has already disclosed, not re-asked for every time a meal gets planned.
- **Real, already-working cross-store price comparison**: in a separate real conversation,
  Shane fed Claude actual weekly store ad flyers and had it find where specific real
  grocery items were cheapest across stores. This is a concrete, already-functioning
  instantiation of Section 3's "background price watchers" concept, applied specifically to
  groceries — the shopping list generation should account for real per-store pricing when
  available, not just produce a flat list against one store. This is being actively built
  into the app's real money-savings mechanism, not a future idea. **Real future automation
  source, confirmed 2026-09-05**: the WPF app (see Section 1) is being explored as a
  WebView2-based local automation tool to pull real coupon/weekly-ad data directly, instead
  of Shane manually feeding flyers into a conversation each time.
- **Real Sunday meal-planning ritual, confirmed 2026-09-05 — refines, doesn't contradict,
  the "no meal-planning calendar" cut above.** The cut was against a calendar UI Shane
  would have to build and manage himself; it was never against meal planning happening at
  all. Real intended workflow: Sundays, Shane works with Claude to build the week's real
  recipe list and meal plan (same Claude + MCP generation pattern as Shopping). That plan
  then surfaces on the Today view as simple, real, moment-based nudges — "ready to make
  dinner," "don't forget to make lunch for tomorrow" — never as a calendar to browse. This
  is the same "batched by real-world moment, not clock time" and "Today view shows only
  what's next" principles from Section 3/8, just applied to meals specifically.

**Real conversational generation pattern, confirmed 2026-09-07 — how Claude should
actually build a shopping list, not just what data feeds it.** Grounded in a real chat
("Budget grocery shopping for a week") where this genuinely worked well, versus a real
counter-example the same night where a flat weekly-ad flyer got dumped straight into a
list without this real process — worse, and it briefly put a real allergen (shrimp) on
the list because nothing checked it first. The real, wanted order:

1. **Establish the real budget conversationally first**, if one hasn't already been
   stated — don't generate a list before knowing the real number to build against.
2. **Read Shane's real stated food preferences before generating anything** (allergies:
   hard exclusion, no exceptions; dislikes: soft avoid) — Section 5's own real allergy/
   dislike data (once #3132 lands) exists specifically so this step is never skipped.
   Real, concrete cost of skipping it: a deathly allergen (shrimp) made it onto a real
   list on 2026-09-07 because this step wasn't run first.
3. **Propose a real, honest starter list with a real running total against the stated
   budget** — and when the math doesn't actually hit the target, say so plainly and trim
   it for real, the way the real chat did ("that comes out closer to $55-65, not $50"),
   not silently round down.
4. **Iterate live as real preferences and specific must-haves come up** — swap an item,
   recompute the real running total immediately, every time, not just at the end.
5. **Ask what's already on hand** — a real item Shane already has (the real chat's
   example: bouillon) comes off the buy list and onto a real, separate "already have /
   get from home" list, the same real split pattern the original session's checklist used.
6. **Only after the base list is real and budget-fit, layer in real weekly-ad-specific
   pricing** (Section 5's price-comparison capability, above) as a refinement — cross-
   reference real current deals against the already-built list, don't let the weekly ad
   itself dictate the whole list from the start.

## 6. Pets — dogs, cats, vet records, vaccines, confirmed 2026-09-05

Named in the very original brainstorm ("dogs and cats") but never locked in until now.
Real, full scope — "all of it," in Shane's words.

**Real per-pet profiles**: each dog/cat gets a real identity (name, species, breed,
birthdate) — same "state once, respected everywhere forever" principle (Section 8) as
everything else. Multiple pets supported, not a single-pet assumption.

**Real vet records — reuses the appointment system (Section 3), doesn't reinvent it.**
A vet visit is just an appointment where the provider is the vet and the subject is the
pet, not Shane. Same real capture, same day-before reminder, same "ask next time" note
(Section 3), same in-visit notes/photos for real documents (vaccine certificates, visit
summaries) — all already built for Shane's own appointments, extended to cover pets.

**Real vaccine schedule tracking**: vaccines have real, often irregular multi-year cycles
(e.g., rabies boosters on a 1- or 3-year cycle depending on the vaccine and local
requirements) — same real irregular-interval support already needed for Shane's own
6-week/2-month appointments (Section 3). **Real reminder timing**: needs lead time similar
to birthdays (Section 3), not just a day-before — enough real notice to actually book the
vet visit before the vaccine lapses, not same-day awareness of something already overdue.

**Real feeding schedules and pet medication**: reuses the existing medication system
(Section 3) — batched by time-of-day, single swipe to complete — rather than building a
separate pet-specific mechanism. A pet's feeding/medication is the same real shape as
Shane's own, just attached to a different real subject.

## 7. People & Patterns — private reflection journal (real, explicit boundaries)

A real, distinct module Shane asked to be added on top of the main design.

**Purpose:** NOT a companion or chatbot persona. A private journal capturing Shane's own
words about people in his life (family/household members), through the same one-box
capture used everywhere else — no separate journaling flow.

**Real behavior:**
- Entries captured casually (a vent, a recap, a frustration, something good) and threaded
  under the relevant person automatically based on who's mentioned.
- Shane can later ask "how have things with [person] been lately" and the app reflects back
  patterns **from Shane's own words only** — summarizing what was said and when. It never
  diagnoses the other person, never presents an in-the-moment feeling as permanent fact,
  never generates advice framed as certainty.
- **Tone: a sharp, honest mirror — not a yes-man, not a companion, not affectionate.**
  Should feel like re-reading your own journal with patterns highlighted, not like talking
  to a person.
- **Explicitly no roleplay, no simulated relationship, no personality performing warmth
  toward Shane.** Any warmth in the app's voice belongs to the nudge/check-in system, never
  to this module.
- Should gently **support, not replace, real therapy** — entries exportable/summarizable as
  material for an actual therapist conversation, not a substitute for one.

**Real visual design:** a simple threaded view per person (photo/name/timeline of entries),
plus a search/ask interface for pattern recall. Calm, private, journal-like visual
language — should NOT look like a chat interface with a persona attached to it.

## 8. Design principles — apply to every screen

- **Trust stated facts immediately.** No confirmation dialogs on what Shane states directly;
  second-guessing is reserved for genuinely ambiguous captures only.
- **Fewer categories always beat more precise organization.**
- **State once, respected everywhere, forever.**
- **Pattern anticipation over reactive reminders** — including Shane's own habits, not just
  other people's requests.
- **No guilt accumulation.** Graceful resets, nothing visually or emotionally piles up.
- **Is this Shane's actual load, or just an interesting feature?** — the real filter Shane
  applied to cut expiration tracking and recipe generation. Apply it to every proposed
  feature, not just food.

## 9. Real new requirements, confirmed tonight (2026-09-05) — not in the original session

- **Real login/auth** — grown from personal prototype into something properly account-gated.
- **Real hosting on Replit.**
- **Real MCP integration** — Claude, in any conversation, can generate a real list (e.g. a
  grocery list) and push it into this app via an MCP tool, not just inside the app's own UI.
- **Shareable links needing NO login** — e.g. a shopping list link Shane can open on his
  phone or hand to someone else, while the rest of the app stays behind real auth. A
  genuine mixed-access-model requirement.

## 10. Real technical constraint to design around

**Shane's Claude subscription does not cover live API costs for a production app.** The AI
parsing/generation step should happen in a Claude conversation via MCP, not as a live API
call triggered by the hosted app itself at runtime. The hosted app stores, displays,
shares, and checks off what Claude already generated — it doesn't do its own live AI
inference. Keep this boundary clean in the architecture.

**Real platform decision, confirmed 2026-09-05: standalone site added to Home Screen, not
Expo Go.** Real, direct precedent already exists — Shane built Aria (a personal AI
assistant iPhone web app) this exact way, and already uses this same pattern for Shane's
Playground in Admin Panel. Real reasons this wins over Expo/React Native: no Apple
Developer Program fee or App Store review needed, pairs naturally with the real
Replit-hosted decision already made (Section 1), and allows instant redeploy-and-refresh
iteration instead of an app-store review cycle. **Real confirmation this actually
supports the notification-tray-as-primary-interface requirement**: iOS has supported real
web push for Home Screen web apps since iOS 16.4 (2023) — notifications appear on the
lock screen and Notification Center exactly like a native app, requiring HTTPS, a valid
manifest.json, and the app added to Home Screen first. One honest caveat from a 2025
source: some developers report occasional reliability issues where iOS web push works
initially then stops unexpectedly — worth monitoring in real use, not a blocker to this
decision.

**Real "enhanced alerts" — slide-down interactive responses, confirmed 2026-09-05.**
Extends the notification-tray-as-primary-interface principle (Section 3) with real
interactivity — act on a notification (mark done, snooze, dismiss) without opening the
full app, matching the real slide-down/pull-down action-button pattern iOS users already
know from native apps. **Real technical uncertainty, not yet resolved**: native iOS apps
have well-established support for this (`UNNotificationCategory`/action buttons); how much
of that same interactivity Safari's Home Screen web-push implementation genuinely supports
is less clear from available documentation — some real sources suggest full action-button
support is more consistently documented for native apps than for Safari's web-push
specifically. Real fallback if full parity isn't achievable: tapping a notification opens
the app directly to the relevant item, which is still fast, just not zero-tap. Needs real
verification during build, not assumed either way.

**Real correction, confirmed 2026-09-05: Expo Go doesn't win this one by being "a real
native app."** Checked directly — there's a long, well-documented history (spanning Expo
SDK 39 through SDK 49, across several years) of developers reporting that interactive
notification action buttons genuinely don't work reliably on iOS specifically through
Expo, even when implemented exactly per Expo's own documentation. One Expo staff response
explicitly stated the Push Notification API didn't support notification actions at all.
The API (`setNotificationCategoryAsync`) exists today, but real-world reports keep
showing it's broken or inconsistent on iOS. **Real conclusion**: both platforms have
genuine uncertainty on this specific feature — Safari's for unclear documentation, Expo's
for a persistent, multi-year real bug pattern — so this doesn't change the real platform
decision above; if anything it reinforces it, since Expo doesn't solve this problem better
while adding real App Store/Developer Program overhead the web-app path avoids.

## 11. What NOT to design

- No dashboard-first layout — the notification tray leads.
- No budget/spending charts or categories anywhere — that's ShanesSurvival's job, not this
  one's.
- No streaks, badges, completion percentages, or gamification.
- No AI persona/companion voice in People & Patterns — it reflects Shane's own words back,
  it doesn't develop opinions of its own about the people in them.
- No inventory/expiration tracking or recipe generation in Food — deliberately cut.
- No time-of-day-scheduled notifications as the primary trigger — context/location first.

## 12. Real open question for Shane, not yet decided

Given the size of the full blueprint versus tonight's real immediate need (hosted
checklists + login + shareable links), what's the real first slice to actually build? The
full blueprint is locked in intent, not in build order.
