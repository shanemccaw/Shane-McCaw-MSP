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
  and weekly-ad data (the same real capability behind Section 4's cross-store price
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
- **Real "Budget Day" ritual, confirmed 2026-09-05 — anchored to Shane's actual real
  biweekly payday (every other Friday), already tracked as `next_pay_date`/
  `pay_frequency_days` on the real income source once the Section 1 unification lands.**
  Distinct from the separate Sunday meal-planning ritual (Section 4) — two different real
  recurring anchors, not the same day. On Budget Day, the app's real job is helping Shane
  stretch a genuinely limited real paycheck as far as possible — "extreme couponing" in
  Shane's own words. This is the real cross-store price comparison and coupon/weekly-ad
  work from Section 4, turned toward its most aggressive, real-savings-maximizing use: given
  the real amount landing this check and what's actually due, where can this specific
  paycheck's real grocery/household spend get the deepest real discount, not just "a"
  discount.
- **Money triage includes background price watchers** on blocked/deferred items, plus a
  sale webhook proposing reallocation against real current priorities.
- **The app should model Shane's own recurring habits into the money math automatically**
  — e.g., knowing Shane tends to buy cigarettes on a given day and accounting for that in
  "available to spend," without being told each time.
- **Hub-and-spoke household logistics**: supplies default to the owned house, split/
  transported to the rental only when Shane is actually heading that direction. Groceries
  are the explicit exception.
- **"Heading Out" checklist triggered by Tesla climate preconditioning**, not a scheduled
  time.
- **Item location memory logs instantly, no confirmation step.**
- **A lightweight "things that need to move or get known" queue**, distinct from Shane's
  own tasks — e.g., "no toilet paper at House B" or "grab the weedeater from House A, bring
  it to House B" gets logged as known information, visible when relevant, not automatically
  owned by Shane to personally fulfill.

## 4. Food — Shopping and Recipes, real superseding update (2026-09-05)

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
  items off, same division of labor as the rest of this app (see Section 8).
- **The original cut still stands for what it was actually about**: no automatic inventory/
  expiration tracking, no recipe-from-pantry-contents generation. Those remain out of
  scope — this update is about *how* Shopping/Recipes get populated (Claude + MCP, on
  request), not about resurrecting pantry-management features Shane already ruled out.
- **The Money-feeder use case still applies, separately**: when Ronnie/DJ mention something
  they need, that's still real budget-awareness information feeding the Money triage view,
  distinct from Shane actively generating his own shopping/recipe lists via Claude.
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
  what's next" principles from Section 3/6, just applied to meals specifically.

## 5. People & Patterns — private reflection journal (real, explicit boundaries)

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

## 6. Design principles — apply to every screen

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

## 7. Real new requirements, confirmed tonight (2026-09-05) — not in the original session

- **Real login/auth** — grown from personal prototype into something properly account-gated.
- **Real hosting on Replit.**
- **Real MCP integration** — Claude, in any conversation, can generate a real list (e.g. a
  grocery list) and push it into this app via an MCP tool, not just inside the app's own UI.
- **Shareable links needing NO login** — e.g. a shopping list link Shane can open on his
  phone or hand to someone else, while the rest of the app stays behind real auth. A
  genuine mixed-access-model requirement.

## 8. Real technical constraint to design around

**Shane's Claude subscription does not cover live API costs for a production app.** The AI
parsing/generation step should happen in a Claude conversation via MCP, not as a live API
call triggered by the hosted app itself at runtime. The hosted app stores, displays,
shares, and checks off what Claude already generated — it doesn't do its own live AI
inference. Keep this boundary clean in the architecture.

## 9. What NOT to design

- No dashboard-first layout — the notification tray leads.
- No budget/spending charts or categories anywhere — that's ShanesSurvival's job, not this
  one's.
- No streaks, badges, completion percentages, or gamification.
- No AI persona/companion voice in People & Patterns — it reflects Shane's own words back,
  it doesn't develop opinions of its own about the people in them.
- No inventory/expiration tracking or recipe generation in Food — deliberately cut.
- No time-of-day-scheduled notifications as the primary trigger — context/location first.

## 10. Real open question for Shane, not yet decided

Given the size of the full blueprint versus tonight's real immediate need (hosted
checklists + login + shareable links), what's the real first slice to actually build? The
full blueprint is locked in intent, not in build order.
