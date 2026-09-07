# Handoff: Shane's Life (contract v2 + critters)

## Overview
Shane's Life is a single-user, ADHD-aware personal operating system. It is the cloud-hosted half of ShanesSurvival (the WPF money app in `desktop/ShanesSurvival/` of `shanemccaw/Shane-McCaw-MSP`): one app, one login, one Postgres. A notification tray leads; one capture box (text / voice / photo) is the only input; rooms open from the tray. Claude does all thinking over MCP; the hosted app stores, shows, shares and checks off. It never calls a model.

The full brief is `uploads/shanes-life-design-contract-pack.md` (copied here as `contract.md`). Every decision below traces to it.

## About the design files
The `.dc.html` files in this bundle are **design references built in HTML**: prototypes showing intended look and behavior, not production code. Recreate them in the target stack. The target is the Replit-hosted web app plus the ShanesSurvival Postgres schema; the mobile companion (`shane-mobile`, Expo) can follow later. Use the Shane McCaw MSP design system (React + Tailwind v4 + shadcn "new-york" + Lucide, dark portal theme) rather than copying inline styles.

## Fidelity
**High-fidelity.** Colors, type, spacing, copy and interactions are final. The design system tokens are in `_ds/…/tokens/*.css`; the prototype uses them via `hsl(var(--background))`, `hsl(var(--card))`, `hsl(var(--card-border))`, `hsl(var(--muted-foreground))`, `hsl(var(--primary))`.

## Non-negotiables (from the contract)
- Tray first, no dashboard. Today shows only what is next.
- One capture box everywhere except sign-in and the alarm screen. No forms.
- Nudges: 1–3 a day, hard cap (`nudgeCap`, default 3). The fourth is **held**, never stacked. Meds batches do not count.
- Context over clock. The only clock-anchored reminders are day-before appointment reminders (contract exception).
- No guilt: reset language ("Let it go", "Not this trip"), nothing turns red except money that is actually short. One deliberate exception: the smoking line confronts with actual spend vs actual shortfall.
- No charts anywhere except **one bar per pay period** in Money.
- No streaks, badges or completion percentages. Wins log is allowed (real milestones only).
- Stated facts land instantly with Undo. Only ambiguous captures ask, with chips, never a form.
- Shopping keeps everything Shane added outside the contract: barcode scan → price, aisle memory from voice, Flat / Category / Best path, weekly-ad verdicts, coupons and multi-buy counts, per-run budget with the put-it-back card, per-store prices with store per phone, Tonight (several dishes to one finish).

## Screens (phone, 402×874 in the prototype; fluid in production)
Every room: 62px top padding, header row (back "Today" in `#60a5fa` 15px left, title 17/700 center, 88px spacer or a small critter right), then a scrolling column with 16px side padding and 14px gaps. Cards: `hsl(var(--card))`, 1px `hsl(var(--card-border))`, radius 16. Row min-height 54–60, 16px horizontal padding, dividers `1px solid hsl(var(--card-border) / .6)`. Section labels: 11px/600, letter-spacing .1em, uppercase, muted.

1. **Sign in** — passkey only (Face ID button 52px primary, ghost "Use a passkey from another device"). Fox critter (128px) above the title. Shared links never see this screen.
2. **Today (tray)** — header: fox 42px, "Saturday, Sep 6", location line (MapPin 11px + "Home · from location"; blue when not home), right: "N of up to 3 nudges today". **Next** card has three variants driven by location: Home (Claude-pushed grocery run: Open Shopping / Share link), Walmart ("You're at Walmart", N items · N Walmart deals, Open the Walmart list / Not shopping), NASA ("At NASA", checklist of work items, Done for now). **Later, by moment**: Heading out, Coming up (→ Dates), Dinner (→ Tonight), At the Rental, Idle (→ Review). **Meds** card (two batches). **Rooms**: Shopping, Recipes, Money, Dates, Pets, Things, People, Lists. Each row: 36px icon tile (Lucide, tinted `rgba(color,.14)`), 15/600 title, 13px muted subtitle, chevron.
3. **Shopping / Shared list** — unchanged from the first slice (see `Shanes Life 04` and `12`). Fox critter in the "Everything's in the cart" card.
4. **Recipes / Cook / Tonight** — unchanged. Alarm screen now shows the bird-with-megaphone critter instead of a bell.
5. **Review** — unchanged card stack; Inbox items carry a `Build queued` teal badge when they came from "Scope a build". Cat critter on the empty state.
6. **Meds** — Morning batch: 3 human items + Biscuit (breakfast, joint chew) + Pepper (breakfast). Before bed: Evening Rx, Magnesium, Pepper's thyroid ½, dinner for both. One slide-to-take per batch. Refills split into "Needs you" and "Handled automatically".
7. **Money** — segmented tabs Now / Bills / Cars / Vault / Wins (5 equal columns, 12.5px/600).
   - **Now**: optional Budget Day card (blue border); *Available to spend* card: label + "next check Fri, Sep 18 · 12 days", amount 40px/800 tabular (red if short), sub-line with the math, **the one bar** (8px, green track `rgba(52,211,153,.22)`, amber fill = shortfall ÷ available, red 100% if short), left label "$X spoken for · Tesla, Electric, Yard", right "Covered" / "Short $X", habit line ("Cigarettes usually run $148 a cycle. Counting that: $Y really."), what-if result box (blue tint), transfer-simulator result box (teal tint, amber "borrowed-from-bill" warning, footer "Never moves money. Do it at NFCU, then it syncs."). Then the existing Price watcher proposal, **Protected** (gate bills + the critical debt row, red amount), **Urgent**, **Already handled**, watchers line, **Catches** (Renewal watch, Forgotten money, Duplicate request, Borrowed from a bill, Bulk buy; "Got it" dismisses), **Cigarettes, in plain numbers** (red-tinted border, shown only while shortfall > 0), footer.
   - **Bills**: every bill account: name (+ `gate` badge), "due · target · has", right status `funded` (green) or `short $X` (amber). One-time pending events (+$6,000 roof reimbursement, −$2,500 deductible) "not counted until real".
   - **Cars**: one card per vehicle (Tesla Model 3, Kia Forte): rows text, all-in $/mo 22px/800, $/yr, next maintenance with lead time.
   - **Vault**: lock note, rows with site + masked reference + **Reveal** (passkey overlay 900ms → full value shown 20 s → Copy). Copy clears the clipboard in 60 s.
   - **Wins**: bear-with-book critter, dated rows. "I did it, …" captures land here; debts hitting $0 land here automatically.
8. **Dates** — groups This week / This month / Later. Row: 46px date tile (month 9px/700 + day 18px/800, tinted by kind), title (+ `New category` badge for on-the-fly categories), line 1 (kind · time · recurrence · sub), line 2 (lead-time rule · "N to ask" · source), right "today / tomorrow / Wed / in N days". Kinds and lead times: appointment 1 day, vet 1, birthday 10, want-to-go 14, federal holiday 7 (OPM, refreshed monthly), visit 3, renewal 21, vaccine 30. Tile colors: appt `#60a5fa`, vet/vaccine `#2dd4bf`, birthday `#f472b6`, event `#fbbf24`, holiday `#a78bfa`, visit `#34d399`, renewal `#fb923c`.
9. **Date detail** — 58px tile + "Wed, Sep 10 · 2:00 PM" 20px/800, meta line, bell row with the lead rule. Appointments and vet visits add **Ask next time** (rows, "Asked" clears) and **Notes and photos, by visit** (date, notes, photo chips with image icon). Other kinds show one explanatory note (holiday source, People threading, interval engine, renewal watch, on-the-fly category).
10. **Pets** — cards: 44px initial avatar, name, species · breed · age, next due line (amber when a vaccine is inside its lead window). **Pet detail**: Vet (linked Dates rows), Vaccines (cycle · last · due/fine-until), Feeding and meds (which Meds batch), Records (photo chips).
11. **Things** — unchanged search + hub/spoke sections, plus **Who fixed what** (name, what · when, phone right in blue). Cat critter with "?" on no result.
12. **Lists** — one card per list (Watch, Books, anything Claude creates), check-circle rows, `New category` badge on lists made on the fly.
13. **People / Person** — unchanged.
14. **Heading Out** — unchanged.

## Overlays
- **Banners** (iOS-style, top:58px, `rgba(30,45,70,.92)` + blur, radius 22): Tesla, Meds AM/PM, and generic (BuildConsole "17 builds are running themselves", day-before "Dr. Fonji tomorrow, 2:00 PM", Budget Day "$1,230.22 landed"). Two 40px actions.
- **Not sure where this goes** sheet (radius 28 top): quoted capture, "Claude's read: <guess>", primary "Make a category: <guess>", outline "Hold it for Claude" / "Scope a build", explanatory footer.
- **Face ID overlay** for sign-in and vault reveal.
- **Toast** with Undo (5 s) for every stated fact.
- **Alarm** full-screen primary blue, 64px time, bird critter.

## Capture grammar (app door; see `submitCapture` in the prototype)
Order matters. Everything is instant, with Undo where a snapshot exists.
1. Person note: `dana: …`, or any text while on a person screen.
2. Meds: `took my meds`, `evening meds done`.
3. Timer: `8 min timer for pasta`.
4. Money handled: `paid the water heater guy`.
5. Heading-out add while on that screen.
6. `what if I spend 60` → Money what-if. `move 200 from Direct Deposit to Tesla` → transfer simulator (flags borrowed-from-bill when the source is a bill account). `I did it, …` / `paid off …` → Wins. `smoked` / `bought a pack` → smoking log (+1 pack, +$8.40).
7. `dr appointment oct 3rd 2pm dr fonji every 6 weeks` → Dates (month, day, time, provider, arbitrary interval). `next time at dr fonji ask about …` → attaches to that provider's next appointment. `ronnie's birthday dec 14` → yearly, 10-day lead. `want to go to the air show nov 7` → event, 14-day lead. `mom's coming to visit the 12th-18th` → **Visits** created on the fly. `watch …` / `read …` → Lists (list created if missing). `pepper rabies due february 2027` → pet vaccine. `plumber is Ray 321-555-0142` → Who fixed what.
8. `where's the drill?` → answers in a toast.
9. Comma / "and" chunks: aisle memory (`pasta aisle 12 end cap`), `… for the rental` → Heading out, `X is in the garage` → Things (requires a place word), grocery words → the run.
10. Anything left over: if it was the whole capture and the app is signed in → **talk-it-through sheet**; otherwise Inbox for Claude's next pull.

## State (prototype `fresh()`; map to tables)
`screen`, `where` (home | walmart | work), `nudges`, `items` (run), `stores` per door, `budget`, `headingOut`, `things`, `contacts`, `inbox` (with `build` flag), `dates` (kind, mi, d, time, every, provider, asks[], visits[{when, notes, photos[]}], pet, person, source, newCat), `pets` (vaccines[], care[], records[]), `lists` {name: [{text, done}]}, `newCats`, `work`, `money` {gate, gateName, reserve[], bills[{id, name, target, bal, gate, due}], events[], wins[], smoke{lastPacks, lastSpent, packs, spent}, habit, catches[], vault[], tab, whatIf, sim, budgetDay, revealed}, `notes`, `reviewDone`, meds/timer/meal/alarm state. Persisted to localStorage under `shaneslife-proto-v4`.

## Money math (mirror `DashboardService.cs`)
- Per bill account: `shortfall = max(0, target_amount − current_balance)`; accounts with no target or no balance are excluded and warned, never treated as $0.
- `reserve_total` = Σ `role = 'reserve'` balances. `total_available` = Income Gate balance + reserve_total. **Top line (available to spend)** = total_available − Σ shortfall. `IsCovered` = top line ≥ 0.
- What-if: `top − habit − amount`; if negative, name the largest-shortfall account as the first to go unfunded.
- Transfer simulator: apply the move to copies of the balances, recompute, list what is still short. If the source is a bill account, flag borrowed-from-bill. **Never executes** (Plaid read-only; NFCU has no Transfer product).
- Habit modeling: subtract the modeled recurring habit (cigarettes, $148/cycle) in the "really" line.
- Budget Day = `income_sources.next_pay_date`, every `pay_frequency_days` (14).

## Data model additions (Postgres, extending ShanesSurvival migrations 001–012)
- `captures(id, text, kind, category TEXT, created_at, routed_to, build_requested BOOL)` — category is free text, not an enum.
- `dates(id, kind TEXT, category TEXT, title, at DATE, time, interval_days INT NULL, lead_days INT, provider, subject_type ('self'|'pet'|'person'), subject_id, source TEXT)`; `date_asks(date_id, text, asked_at NULL)`; `date_visits(date_id, visited_on, notes)`; `date_photos(visit_id, url, label)`.
- `federal_holidays(year, name, observed_on)` refreshed monthly from OPM.
- `pets(id, name, species, breed, born)`; `pet_vaccines(pet_id, name, interval_days, last_on, due_on)`; `pet_care(pet_id, name, batch)`.
- `lists(name, created_by ('shane'|'claude'))`; `list_items(list_id, text, done)`.
- `things(name, place, house)`; `contacts(name, phone, did, house, when)`.
- `wins(when, text, source)`; `smoke_log(at, packs, amount)`; `catches(kind, text, dismissed_at)`.
- `vault(id, label, site, masked, ciphertext)` — AES-256-GCM at rest, key outside the DB, passkey (WebAuthn) re-auth per reveal, 20 s display, audit row per reveal. This is a stated security requirement, not polish.
- `vehicles(name, loan_bill_id, insurance_amount, registration_due, registration_amount, maintenance_interval_miles)`.
- `nudges(day, count)` for the 3/day cap; `hooks(kind, payload, at)` for Tesla, BuildConsole, location.

## MCP tools (Claude side, on the subscription)
Existing: `push_list`, `push_checklist`, `pull_inbox`, `route`, `get_prices`, `get_store_map`, `fetch_weekly_ad(store, zip)`, `push_deals`, `push_coupons`, `add_note`, `set_watcher`.
New: `new_category(name, icon, lead_days)`, `push_date(...)`, `attach_ask(provider, text)`, `attach_visit(date_id, notes, photos)`, `push_recipes(meal_plan)` (heart-healthy context applied once, forever), `get_gate_status()`, `what_if(amount)`, `simulate_transfer(amount, from, to)`, `log_win(text)`, `log_smoke()`, `scope_build(summary)` → BuildConsole issue.
WPF (local automation): `push_ads`, `push_coupons` via WebView2 scraping; `plaid_sync`; `opm_holidays(year)`.
Webhooks in: `/hooks/tesla`, `/hooks/buildconsole` (queue depth threshold; verify BuildConsole can post outbound first), `/hooks/location {place}`.

## Auth and sharing
Passkeys (WebAuthn) for the app. `/l/:token` share links: no login, lists only, check/add/scan/aisle allowed, revocable. Everything else 401s without a session. Vault reveal requires a fresh passkey assertion even inside a session.

## Design tokens
Design system dark theme via `_ds/…/tokens`. Accents used: blue `#60a5fa`, teal `#2dd4bf`, amber `#fbbf24`, red `#f87171`, green `#34d399`, violet `#a78bfa`, indigo `#a5b4fc`, pink `#f472b6`, orange `#fb923c`; tints at `.14`–`.16` alpha for tiles, `.35`–`.45` for emphasis borders. Type: Inter; 40/800 money amount, 26/800 alarm and review copy, 22/800 room heroes, 19/700 next-card title, 17/700 headers, 16 list text, 15/600 row titles, 13 muted sublines, 12 footers, 11/600 uppercase labels (.1em). Radii: 16 cards, 12 tiles/inputs, 10 small tiles, 999 pills, 28 sheet top, 22 banners. Shadows: `var(--shadow-dark-lg)` on sheets, `var(--glow-blue-sm)` on primary knobs.

## Critters (Sep 7, final direction)
Clarity-style soft-gradient animals, decorative only, never a mechanic. Spec drawings: `Shanes Life 14 - Critters.dc.html` (ids 1a–1x, each with placement). Shared family rules: vertical gradient body, cream belly, dark dot eyes, blush `#F472B6`, one navy ground shadow (`#1E3A8A` at .7). Production should port the set into BuildConsole's vector roster (`desktop/BuildConsole/Controls/BuildQueuePanel.xaml.cs`, `CreateCute*Vector`) so Shane's tools share one family.

**Pairs and the daily roll.** Every slot has two drawings (Idle has three). One is picked per slot per day: `idx = fnv1a(dateKey + "|" + slotName) % variants.length`, evaluated once at first open from the server date, so a slot shows the same critter everywhere that day and changes tomorrow. Nothing animates between them. When one pair appears twice on a screen (Dinner row + Recipes row, Coming up row + Dates row) the second use takes the other half of the pair (`Alt`). Fixed, never rolled: sign-in fox (1t) and the alarm / shared-link-waiting bird (1v).

**Where they replace icons (36px unless noted).** Tray "Later" rows: Heading out (raccoon or puppy leaning out of a Model 3, side profile), Coming up (owl / bird), Dinner (otter chef / bear with pot), At the Rental (hamster at door / cat on rug), Idle (koala / snail / sloth). Rooms rows: Shopping, Recipes, Money, Dates, Pets, Things, People, Lists. Next cards at 44px: grocery run and Walmart (penguin with cart / hamster with bag), NASA (hamster in helmet / penguin with rocket). Heading Out hero 44px. Room headers top-right: Money, Dates, Pets, Lists, Meds. Meds: tray card 40px (frog with pill / bear with bottle), Morning batch and "Morning taken" (panda with coffee / chick at sunrise), Before bed (bunny in nightcap / koala asleep). Wins hero 104px (seal with star / otter with trophy). Review done and Things "?" keep the cat (from behind / peeking). Lucide stays for actions: chevrons, scan, mic, check circles, undo.

**Peekers (tray only).** Six wide "Kilroy" critters (`pkw-cat`, `pkw-fox`, `pkw-rac`, `pkw-frog`, `pkw-bear`, `pkw-owl`; viewBox `0 0 260 64`, ledge line at y=52) sit on every tray section label (Next, Later, Meds, Rooms) and fill the space right of the label. Label row: `position:relative; display:flex; align-items:flex-end; min-height:40px`. Peeker svg: `position:absolute; left:<label width + 30>px; right:0; height:52px; bottom:-18px; preserveAspectRatio="xMidYMax meet"`, which puts the ledge line exactly on the card's top border. The head is clipped to y≤52 (`clipPath`); only the paws and toes cross onto the card face. Pupils run `@keyframes pkLook` (8px left, 8px right, 5s loop, ease-in-out). Four different ones a day: `b = fnv1a(dateKey + "|peek") % 6`, Next = b, Later = b+1, Meds = b+2, Rooms = b+3.

**Room watermarks.** Every room shows its own rolled critter as a faint watermark: 260px, `opacity:.12`, `position:absolute; right:-44px; bottom:78px` (above the capture bar), `pointer-events:none`, painted over the content so it shows through list rows. Map: Shopping and the shared link → shop pair; Recipes / Cook / Tonight → dinner; Review → idle; Meds → meds; Money Bills and Cars → bear, Vault → vault, Wins → wins; Dates and Date detail → coming up; Pets → pets; Things → things; Heading Out → heading; People → people; Lists → lists. No watermark on the tray, sign-in, Money "Now" (the shortfall bar and smoking line stay plain), the shared-link waiting screen, or inside a person's journal.

**Prototype controls.** "Critters: roll for <day>" above Reset advances the seed a day to preview other rolls (`critDay` in state). On the critter sheet, "Roll another day" does the same and tapping a small critter forces it.

## Files
- `Shanes Life - First Slice Prototype.dc.html` — the working prototype (both phones). This is the primary reference; it's the only file with all v2 logic wired end-to-end.
- `Shanes Life 00 - Design Pack.dc.html` — index and decision log (contract v2 section).
- `Shanes Life 01 - Sign in.dc.html` … `Shanes Life 12 - Shared list.dc.html` — one page per room/screen, each showing the option(s) considered with the chosen badge. Use these to read a single screen's layout in isolation; use the First Slice Prototype for real interaction and data flow between screens.
- `Shanes Life 13 - Architecture.dc.html` — 2a (one system with ShanesSurvival) and 1w (MCP boundary).
- `Shanes Life 14 - Critters.dc.html` — the critter spec: 23 slots in pairs, wide peekers, daily roll preview.
- `contract.md` — the v2 design contract (source brief, all decisions traced from it).
- `_ds/`, `ios-frame.jsx`, `browser-window.jsx`, `support.js` — runtime assets the `.dc.html` files load; keep them alongside the pages if you open the files directly rather than reading the code.
- `screenshots/` — rendered PNGs of the prototype with critters in place: sign-in, tray (peekers), shopping (watermark), money, dates, pets, lists, and the critter sheet.
- `github.md` (project root) — repo association and screen map.
